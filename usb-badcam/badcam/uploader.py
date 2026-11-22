"""HTTP client and per-event upload algorithm (contract v1, PLAN section 3)."""

from __future__ import annotations

import hashlib
import http.client
import json
import os
import time
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from . import log
from .scanner import ScanEvent, ScanFile
from .state import State

BACKOFF = (2, 5, 15)
MIN_CHUNK = 64 * 1024


class CycleAbort(Exception):
    """End the current cycle; `backoff_s` is how long to wait before the next."""

    def __init__(self, reason: str, backoff_s: int = 0) -> None:
        super().__init__(reason)
        self.reason = reason
        self.backoff_s = backoff_s


class Interrupted(Exception):
    """Raised by the stop check (car power back, low battery, time cap)."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class FileSkipped(Exception):
    pass


@dataclass
class Result:
    status: int
    body: dict


@dataclass
class CycleStats:
    files: int = 0
    bytes: int = 0
    deleted: int = 0
    errors: int = 0
    events_completed: int = 0
    started: float = 0.0
    seconds: float = 0.0
    notes: list[str] = field(default_factory=list)

    def summary(self) -> str:
        return (
            f"files={self.files} bytes={self.bytes} deleted={self.deleted} "
            f"events_completed={self.events_completed} errors={self.errors} seconds={self.seconds:.1f}"
        )


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            b = fh.read(1024 * 1024)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


class ApiClient:
    """One persistent HTTP(S) connection; three retries per request."""

    def __init__(
        self,
        url: str,
        token: str,
        timeout: float = 30,
        sleep: Callable[[float], None] = time.sleep,
        backoff: tuple[float, ...] = BACKOFF,
    ) -> None:
        u = urllib.parse.urlparse(url)
        self.https = u.scheme == "https"
        self.host = u.hostname or ""
        self.port = u.port or (443 if self.https else 80)
        self.prefix = u.path.rstrip("/")
        self.token = token
        self.timeout = timeout
        self.sleep = sleep
        self.backoff = backoff
        self.conn: http.client.HTTPConnection | None = None

    def close(self) -> None:
        if self.conn:
            try:
                self.conn.close()
            finally:
                self.conn = None

    def _connect(self) -> http.client.HTTPConnection:
        if self.conn is None:
            cls = http.client.HTTPSConnection if self.https else http.client.HTTPConnection
            self.conn = cls(self.host, self.port, timeout=self.timeout)
        return self.conn

    def request(
        self,
        method: str,
        path: str,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> Result:
        hdrs = {"Authorization": f"Bearer {self.token}", "User-Agent": "badcam/2"}
        if body is not None:
            hdrs.setdefault("Content-Type", "application/json")
        hdrs.update(headers or {})
        last: Exception | None = None
        for attempt in range(len(self.backoff) + 1):
            try:
                conn = self._connect()
                conn.request(method, self.prefix + path, body=body, headers=hdrs)
                resp = conn.getresponse()
                raw = resp.read()
                try:
                    data = json.loads(raw) if raw else {}
                except ValueError:
                    data = {}
                if resp.status in (429, 503):
                    retry = resp.getheader("Retry-After")
                    last = RuntimeError(f"HTTP {resp.status}")
                    if attempt < len(self.backoff):
                        wait = min(float(retry), 60) if retry and retry.replace(".", "").isdigit() else self.backoff[attempt]
                        self.sleep(wait)
                        continue
                    raise CycleAbort(f"server busy ({resp.status})", 300)
                return Result(resp.status, data if isinstance(data, dict) else {})
            except (OSError, http.client.HTTPException) as exc:
                last = exc
                self.close()
                if attempt < len(self.backoff):
                    self.sleep(self.backoff[attempt])
        raise CycleAbort(f"network error: {last}", 60)

    # -- API ---------------------------------------------------------------
    def _json(self, method: str, path: str, obj: dict) -> Result:
        return self.request(method, path, json.dumps(obj).encode())

    def ping(self, body: dict) -> Result:
        return self._json("POST", "/api/v1/ping", body)

    def check(self, files: list[dict]) -> dict[str, dict]:
        out: dict[str, dict] = {}
        for i in range(0, len(files), 500):
            r = self._json("POST", "/api/v1/files/check", {"files": files[i : i + 500]})
            self._raise_common(r)
            if r.status != 200:
                raise CycleAbort(f"check failed: HTTP {r.status}", 60)
            for entry in r.body.get("files", []):
                out[entry["path"]] = entry
        return out

    def complete(self, kind: str, event: str, files: int) -> Result:
        return self._json("POST", "/api/v1/events/complete", {"kind": kind, "event": event, "files": files})

    @staticmethod
    def _raise_common(r: Result) -> None:
        if r.status == 401:
            raise CycleAbort("unauthorized (check server.token)", 600)
        if r.status == 507:
            raise CycleAbort("server storage full", 1800)

    def url_path(self, rel: str) -> str:
        return "/api/v1/files/" + "/".join(urllib.parse.quote(s, safe="") for s in rel.split("/"))


class Uploader:
    """Uploads event folders; optionally deletes after a successful upload."""

    def __init__(
        self,
        client: ApiClient,
        state: State,
        chunk_bytes: int = 8 * 1024 * 1024,
        stop_check: Callable[[], str | None] | None = None,
        delete: bool = False,
        record_invalid: bool = True,
    ) -> None:
        self.client = client
        self.state = state
        self.chunk = chunk_bytes
        self.stop_check = stop_check or (lambda: None)
        self.delete = delete
        self.record_invalid = record_invalid
        self.stats = CycleStats(started=time.monotonic())

    # -- single file ----------------------------------------------------------
    def _check_stop(self) -> None:
        reason = self.stop_check()
        if reason:
            raise Interrupted(reason)

    def upload_file(self, f: ScanFile, offset: int, sha: str) -> Result:
        """Upload from `offset`; returns the final 200/201 result."""
        attempts = 0
        conflicts = 0
        total = f.size
        chunk = self.chunk
        while True:
            self._check_stop()
            end = min(offset + chunk, total)
            try:
                with open(f.abs, "rb") as fh:
                    fh.seek(offset)
                    data = fh.read(end - offset)
            except OSError as exc:
                raise FileSkipped(f"read error: {exc}")
            if len(data) != end - offset:
                raise FileSkipped("file changed while reading")
            hdrs = {
                "Content-Range": f"bytes {offset}-{end - 1}/{total}",
                "Content-Type": "application/octet-stream",
            }
            if end == total:
                hdrs["X-Badcam-Sha256"] = sha
            r = self.client.request("PUT", self.client.url_path(f.rel), body=data, headers=hdrs)
            s = r.status
            if s in (200, 201):
                self.stats.bytes += len(data)
                return r
            if s == 202:
                self.stats.bytes += len(data)
                offset = int(r.body.get("offset", end))
            elif s == 409:
                conflicts += 1
                if conflicts > 20:
                    raise FileSkipped("too many offset conflicts")
                offset = int(r.body.get("offset", 0))
            elif s == 422:
                attempts += 1
                if attempts >= 3:
                    raise FileSkipped("sha mismatch three times")
                offset = 0
            elif s == 413:
                if chunk <= MIN_CHUNK:
                    raise FileSkipped("server rejects even small chunks")
                chunk = max(MIN_CHUNK, chunk // 2)
            elif s == 400:
                raise FileSkipped(f"server rejected request: {r.body}")
            elif s in (401, 507):
                self.client._raise_common(r)
            else:
                raise FileSkipped(f"unexpected HTTP {s}")

    # -- event ----------------------------------------------------------------
    def sync_event(self, ev: ScanEvent) -> bool:
        """Upload every non-junk file of one event. Returns True if all are recorded."""
        files = ev.upload_order()
        if not files:
            return False
        checks = self.client.check([{"path": f.rel, "size": f.size} for f in files])
        all_recorded = True
        for f in files:
            self._check_stop()
            try:
                ok = self._sync_file(f, checks.get(f.rel, {"state": "missing", "offset": 0}))
            except FileSkipped as exc:
                log.get().warning("skip %s: %s", f.rel, exc)
                self.stats.errors += 1
                ok = False
            if not ok:
                all_recorded = False
        if all_recorded and ev.kind != "RecentClips":
            r = self.client.complete(ev.kind, ev.name, len(files))
            if r.status == 200:
                self.stats.events_completed += 1
            elif r.status == 404:
                log.get().warning("events/complete: unknown event %s", ev.key)
            else:
                self.client._raise_common(r)
                self.stats.errors += 1
                all_recorded = False
        if self.delete and all_recorded and ev.folder is not None and ev.kind != "RecentClips":
            self._remove_empty(ev.folder)
        return all_recorded

    def _sync_file(self, f: ScanFile, chk: dict) -> bool:
        rec = self.state.get(f.rel)
        state = chk.get("state", "missing")
        if state == "complete" and chk.get("size") == f.size:
            if rec and rec.size == f.size and rec.mtime == f.mtime:
                self._done(f, rec.sha256, rec.valid, upload=False)
                return True
            local = sha256_file(f.abs)
            if local == chk.get("sha256"):
                self.state.record(f.rel, f.size, f.mtime, local, True)
                self._done(f, local, True, upload=False)
                return True
            offset = 0
        else:
            offset = int(chk.get("offset", 0)) if state == "partial" else 0
        sha = sha256_file(f.abs)
        r = self.upload_file(f, offset, sha)
        valid = bool(r.body.get("valid", True))
        self.stats.files += 1
        if not valid and not self.record_invalid:
            log.get().info("server says %s is not valid yet; will retry detached", f.rel)
            return False
        self.state.record(f.rel, f.size, f.mtime, sha, valid)
        self._done(f, sha, valid, upload=True)
        return True

    def _done(self, f: ScanFile, sha: str, valid: bool, upload: bool) -> None:
        if self.delete:
            self.delete_if_unchanged(f)

    def delete_if_unchanged(self, f: ScanFile) -> bool:
        try:
            st = os.stat(f.abs)
            if st.st_size != f.size or int(st.st_mtime) != f.mtime:
                return False
            os.unlink(f.abs)
        except OSError:
            return False
        self.stats.deleted += 1
        return True

    @staticmethod
    def _remove_empty(folder: Path) -> None:
        try:
            os.rmdir(folder)
        except OSError:
            pass

    def run(self, events: list[ScanEvent]) -> CycleStats:
        try:
            for ev in events:
                self.sync_event(ev)
        finally:
            self.stats.seconds = time.monotonic() - self.stats.started
        return self.stats
