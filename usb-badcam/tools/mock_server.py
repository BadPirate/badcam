#!/usr/bin/env python3
"""Mock of the badcam web API v1 (PLAN section 3) for tests and the demo.

In-memory index, files on disk under --data. Fault injection is done through
attributes on `MockState` (tests) or the --fault flags (CLI).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PATH_RE = re.compile(
    r"^(?:(?:SentryClips|SavedClips)/\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/[A-Za-z0-9._-]{1,80}"
    r"|RecentClips/[A-Za-z0-9._-]{1,80})$"
)
RANGE_RE = re.compile(r"^bytes (\d+)-(\d+)/(\d+)$")
TOKEN_RE = re.compile(r"^bc_[A-Za-z0-9_-]{43}$")
MAX_CHUNK = 16 * 1024 * 1024


class MockState:
    def __init__(self, data: Path, token: str | None = None) -> None:
        self.data = Path(data)
        self.files_dir = self.data / "files"
        self.partial_dir = self.data / "partial"
        self.files_dir.mkdir(parents=True, exist_ok=True)
        self.partial_dir.mkdir(parents=True, exist_ok=True)
        self.token = token
        self.lock = threading.Lock()
        self.index: dict[str, tuple[int, str]] = {}  # path -> (size, sha256)
        self.completed: list[dict] = []
        self.requests: list[tuple[str, str, int]] = []
        self.ping_count = 0
        # fault injection
        self.drop_mid_chunk = 0  # next N PUTs: store half the chunk, then drop the connection
        self.force_409 = 0  # next N PUTs answer 409 with the real offset
        self.fail_422 = 0  # next N final chunks answer 422 and discard the partial
        self.storage_full = False
        self.unauthorized = False
        self.accepting = True
        self.invalid_substrings: list[str] = []  # files containing these answer valid:false
        self.max_chunk = MAX_CHUNK
        self.use_ffprobe = False

    def fpath(self, rel: str) -> Path:
        return self.files_dir / rel

    def ppath(self, rel: str) -> Path:
        return self.partial_dir / rel.replace("/", "__")

    def file_list(self) -> list[str]:
        return sorted(self.index)


def _valid(state: MockState, rel: str, path: Path) -> bool:
    if any(s in rel for s in state.invalid_substrings):
        return False
    if state.use_ffprobe and rel.endswith(".mp4") and shutil.which("ffprobe"):
        r = subprocess.run(["ffprobe", "-v", "error", str(path)], capture_output=True)
        return r.returncode == 0
    return True


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "badcam-mock/1"
    state: MockState

    def log_message(self, fmt: str, *args) -> None:  # quiet
        pass

    # -- helpers ----------------------------------------------------------
    def _send(self, status: int, obj: dict, headers: dict | None = None) -> None:
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _auth(self) -> bool:
        st = self.state
        h = self.headers.get("Authorization", "")
        ok = h.startswith("Bearer ") and not st.unauthorized
        if ok:
            tok = h[7:]
            ok = (tok == st.token) if st.token else bool(TOKEN_RE.match(tok))
        if not ok:
            self._drain()
            self._send(401, {"error": "unauthorized"})
        return ok

    def _drain(self) -> bytes:
        n = int(self.headers.get("Content-Length", "0") or 0)
        return self.rfile.read(n) if n else b""

    # -- routes -----------------------------------------------------------
    def do_POST(self) -> None:
        st = self.state
        path = urllib.parse.urlparse(self.path).path
        st.requests.append(("POST", path, 0))
        if not self._auth():
            return
        try:
            body = json.loads(self._drain() or b"{}")
        except ValueError:
            return self._send(400, {"error": "bad_request"})
        if path == "/api/v1/ping":
            st.ping_count += 1
            return self._send(200, {
                "ok": True, "device": "mock", "time": "2026-11-22T12:00:00Z",
                "max_chunk_bytes": st.max_chunk, "accepting": st.accepting,
            })
        if path == "/api/v1/files/check":
            files = body.get("files", [])
            if len(files) > 500:
                return self._send(400, {"error": "too_many"})
            out = []
            for f in files:
                rel = f.get("path", "")
                if not PATH_RE.match(rel):
                    return self._send(400, {"error": "bad_path"})
                with st.lock:
                    if rel in st.index:
                        size, sha = st.index[rel]
                        out.append({"path": rel, "state": "complete", "size": size, "sha256": sha})
                    elif st.ppath(rel).exists():
                        out.append({"path": rel, "state": "partial", "offset": st.ppath(rel).stat().st_size})
                    else:
                        out.append({"path": rel, "state": "missing", "offset": 0})
            return self._send(200, {"files": out})
        if path == "/api/v1/events/complete":
            kind, event = body.get("kind"), body.get("event")
            if kind not in ("SentryClips", "SavedClips") or not isinstance(event, str):
                return self._send(400, {"error": "bad_request"})
            prefix = f"{kind}/{event}/"
            with st.lock:
                if not any(p.startswith(prefix) for p in st.index):
                    return self._send(404, {"error": "unknown_event"})
                st.completed.append(body)
            return self._send(200, {"ok": True, "queued": True})
        self._drain()
        self._send(404, {"error": "not_found"})

    def do_PUT(self) -> None:
        st = self.state
        parsed = urllib.parse.urlparse(self.path)
        prefix = "/api/v1/files/"
        st.requests.append(("PUT", parsed.path, 0))
        if not self._auth():
            return
        if not parsed.path.startswith(prefix):
            self._drain()
            return self._send(404, {"error": "not_found"})
        rel = "/".join(urllib.parse.unquote(s) for s in parsed.path[len(prefix):].split("/"))
        m = RANGE_RE.match(self.headers.get("Content-Range", ""))
        if not PATH_RE.match(rel):
            self._drain()
            return self._send(400, {"error": "bad_path"})
        if not m:
            self._drain()
            return self._send(400, {"error": "bad_range"})
        start, end, total = (int(x) for x in m.groups())
        length = int(self.headers.get("Content-Length", "0") or 0)
        if end < start or end >= total or length != end - start + 1:
            self._drain()
            return self._send(400, {"error": "bad_range"})
        if length > st.max_chunk:
            self._drain()
            return self._send(413, {"error": "chunk_too_large"})
        if st.storage_full:
            self._drain()
            return self._send(507, {"error": "storage_full"})
        data = self.rfile.read(length)
        part = st.ppath(rel)
        with st.lock:
            if start == 0:
                part.write_bytes(b"")
            cur = part.stat().st_size if part.exists() else 0
            if st.force_409 > 0:
                st.force_409 -= 1
                return self._send(409, {"error": "offset_mismatch", "offset": cur})
            if start != cur:
                return self._send(409, {"error": "offset_mismatch", "offset": cur})
            if st.drop_mid_chunk > 0:
                st.drop_mid_chunk -= 1
                with open(part, "ab") as fh:
                    fh.write(data[: len(data) // 2])
                self.close_connection = True
                self.connection.close()
                return
            with open(part, "ab") as fh:
                fh.write(data)
            if end + 1 < total:
                return self._send(202, {"state": "partial", "offset": end + 1})
            sha_hdr = self.headers.get("X-Badcam-Sha256", "")
            actual = hashlib.sha256(part.read_bytes()).hexdigest()
            if st.fail_422 > 0 or actual != sha_hdr:
                if st.fail_422 > 0:
                    st.fail_422 -= 1
                part.unlink(missing_ok=True)
                return self._send(422, {"error": "sha_mismatch"})
            existed = st.index.get(rel)
            dest = st.fpath(rel)
            dest.parent.mkdir(parents=True, exist_ok=True)
            part.replace(dest)
            st.index[rel] = (total, actual)
            valid = _valid(st, rel, dest)
            status = 200 if existed == (total, actual) else 201
            return self._send(status, {"state": "complete", "sha256": actual, "valid": valid})


def make_server(data: Path | None = None, port: int = 0, token: str | None = None) -> tuple[ThreadingHTTPServer, MockState]:
    data = data or Path(tempfile.mkdtemp(prefix="badcam-mock-"))
    state = MockState(data, token)
    handler = type("BoundHandler", (Handler,), {"state": state})
    srv = ThreadingHTTPServer(("127.0.0.1", port), handler)
    srv.daemon_threads = True
    return srv, state


def start_background(data: Path | None = None, port: int = 0, token: str | None = None):
    srv, state = make_server(data, port, token)
    t = threading.Thread(target=srv.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True)
    t.start()
    return srv, state, f"http://127.0.0.1:{srv.server_address[1]}"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--data", type=Path, default=Path("./mock-data"))
    ap.add_argument("--token", default=None, help="exact token to accept (default: any well-formed bc_ token)")
    ap.add_argument("--ffprobe", action="store_true", help="validate .mp4 files with ffprobe")
    ap.add_argument("--fault-drop", type=int, default=0, help="drop the connection mid-chunk N times")
    ap.add_argument("--fault-409", type=int, default=0)
    ap.add_argument("--fault-422", type=int, default=0)
    ap.add_argument("--fault-507", action="store_true")
    a = ap.parse_args()
    srv, state = make_server(a.data, a.port, a.token)
    state.use_ffprobe = a.ffprobe
    state.drop_mid_chunk, state.force_409, state.fail_422 = a.fault_drop, a.fault_409, a.fault_422
    state.storage_full = a.fault_507
    print(f"mock badcam server on http://127.0.0.1:{a.port}, data in {a.data}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
