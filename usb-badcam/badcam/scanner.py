"""Walk a mounted TeslaCam tree: path grammar, junk rule, stability rule, order."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

PATH_RE = re.compile(
    r"^(?:(?:SentryClips|SavedClips)/\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/[A-Za-z0-9._-]{1,80}"
    r"|RecentClips/[A-Za-z0-9._-]{1,80})$"
)
EVENT_RE = re.compile(r"^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$")
JUNK_BYTES = 100_000


def valid_path(rel: str) -> bool:
    return bool(PATH_RE.match(rel))


def is_junk(rel: str, size: int) -> bool:
    """Empty files and sub-100 kB clips are junk (teslausb rule, clips only)."""
    return size == 0 or (rel.endswith(".mp4") and size < JUNK_BYTES)


@dataclass
class ScanFile:
    rel: str
    abs: Path
    size: int
    mtime: int

    @property
    def name(self) -> str:
        return self.rel.rsplit("/", 1)[-1]

    @property
    def junk(self) -> bool:
        return is_junk(self.rel, self.size)


@dataclass
class ScanEvent:
    kind: str  # SentryClips | SavedClips | RecentClips
    name: str  # folder name, or YYYY-MM-DD_HH for RecentClips
    files: list[ScanFile] = field(default_factory=list)
    folder: Path | None = None

    @property
    def key(self) -> str:
        return f"{self.kind}/{self.name}"

    @property
    def has_event_json(self) -> bool:
        return any(f.name == "event.json" for f in self.files)

    def signature(self) -> tuple:
        return tuple(sorted((f.rel, f.size, f.mtime) for f in self.files))

    def upload_order(self) -> list[ScanFile]:
        """event.json, thumb.png, then clips ascending; junk excluded."""
        def rank(f: ScanFile) -> tuple[int, str]:
            if f.name == "event.json":
                return (0, f.name)
            if f.name == "thumb.png":
                return (1, f.name)
            return (2, f.name)

        return sorted((f for f in self.files if not f.junk), key=rank)


def _entry(rel: str, path: Path) -> ScanFile | None:
    try:
        st = path.stat()
    except OSError:
        return None
    return ScanFile(rel, path, st.st_size, int(st.st_mtime))


def scan(mount: Path, upload_recent: bool = False) -> list[ScanEvent]:
    """Return events ordered SavedClips, SentryClips, RecentClips; newest first."""
    base = Path(mount) / "TeslaCam"
    events: list[ScanEvent] = []
    for kind in ("SavedClips", "SentryClips"):
        kdir = base / kind
        if not kdir.is_dir():
            continue
        for name in sorted(os.listdir(kdir), reverse=True):
            folder = kdir / name
            if not EVENT_RE.match(name) or not folder.is_dir():
                continue
            ev = ScanEvent(kind, name, [], folder)
            for fname in sorted(os.listdir(folder)):
                rel = f"{kind}/{name}/{fname}"
                if not valid_path(rel):
                    continue
                f = _entry(rel, folder / fname)
                if f and (folder / fname).is_file():
                    ev.files.append(f)
            events.append(ev)
    if upload_recent:
        rdir = base / "RecentClips"
        groups: dict[str, ScanEvent] = {}
        if rdir.is_dir():
            for fname in sorted(os.listdir(rdir)):
                rel = f"RecentClips/{fname}"
                if not valid_path(rel) or len(fname) < 13:
                    continue
                f = _entry(rel, rdir / fname)
                if f is None or not (rdir / fname).is_file():
                    continue
                key = fname[:13]
                groups.setdefault(key, ScanEvent("RecentClips", key, [], rdir)).files.append(f)
        events.extend(sorted(groups.values(), key=lambda e: e.name, reverse=True))
    return events


class StabilityTracker:
    """An event is stable when its file list, sizes and mtimes have not changed
    for `settle_s` seconds and it has an event.json (live mode only)."""

    def __init__(self, settle_s: int) -> None:
        self.settle_s = settle_s
        self._seen: dict[str, tuple[tuple, float]] = {}

    def update(self, events: list[ScanEvent], now: float) -> list[ScanEvent]:
        current: dict[str, tuple[tuple, float]] = {}
        stable: list[ScanEvent] = []
        for ev in events:
            sig = ev.signature()
            prev = self._seen.get(ev.key)
            first = prev[1] if prev and prev[0] == sig else now
            current[ev.key] = (sig, first)
            if ev.kind == "RecentClips":
                continue  # live mode never uploads the rolling folder
            if ev.has_event_json and now - first >= self.settle_s and ev.files:
                stable.append(ev)
        self._seen = current
        return stable
