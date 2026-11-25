#!/usr/bin/env python3
"""Build a fake TeslaCam/ tree (PLAN section 2) for tests and the demo."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import random
import shutil
import struct
import subprocess
import zlib
from pathlib import Path

CAMERAS = ["front", "back", "left_repeater", "right_repeater"]
MIN_CLIP = 150_000


def png(w: int = 64, h: int = 48) -> bytes:
    raw = b"".join(
        b"\x00" + bytes(v for x in range(w) for v in (x * 4 % 256, y * 5 % 256, 128)) for y in range(h)
    )
    def chunk(t: bytes, d: bytes) -> bytes:
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def make_clip(path: Path, seed: str, use_ffmpeg: bool) -> None:
    if use_ffmpeg and shutil.which("ffmpeg"):
        res = subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1280x960:r=36:d=2",
             "-c:v", "libx264", "-preset", "ultrafast", "-crf", "8", "-pix_fmt", "yuv420p",
             "-metadata", f"comment={seed}", "-movflags", "+faststart", str(path)],
            capture_output=True,
        )
        if res.returncode == 0 and path.stat().st_size >= 100_000:
            return
    rnd = random.Random(seed)
    path.write_bytes(rnd.randbytes(MIN_CLIP + rnd.randrange(50_000)))


def build(root: Path, events: int, minutes: int, kind: str = "SentryClips",
          cameras: list[str] | None = None, use_ffmpeg: bool = True, junk: bool = False,
          start: str = "2026-11-20_18-00-00") -> list[Path]:
    cameras = cameras or CAMERAS
    base = dt.datetime.strptime(start, "%Y-%m-%d_%H-%M-%S")
    made: list[Path] = []
    (root / "TeslaCam" / "RecentClips").mkdir(parents=True, exist_ok=True)
    for e in range(events):
        t0 = base + dt.timedelta(minutes=30 * e)
        name = t0.strftime("%Y-%m-%d_%H-%M-%S")
        folder = root / "TeslaCam" / kind / name
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "event.json").write_text(json.dumps({
            "timestamp": (t0 + dt.timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M:%S"),
            "city": "Amsterdam", "est_lat": "52.3676", "est_lon": "4.9041",
            "reason": "sentry_aware_object_detection", "camera": "0"}))
        (folder / "thumb.png").write_bytes(png())
        for m in range(minutes):
            ts = (t0 + dt.timedelta(minutes=m)).strftime("%Y-%m-%d_%H-%M-%S")
            for cam in cameras:
                clip = folder / f"{ts}-{cam}.mp4"
                make_clip(clip, f"{name}-{ts}-{cam}", use_ffmpeg)
                made.append(clip)
        if junk:
            (folder / f"{(t0 + dt.timedelta(minutes=minutes)).strftime('%Y-%m-%d_%H-%M-%S')}-front.mp4").write_bytes(b"x" * 500)
    return made


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("dir", type=Path)
    ap.add_argument("--events", type=int, default=2)
    ap.add_argument("--minutes", type=int, default=2)
    ap.add_argument("--kind", default="SentryClips", choices=["SentryClips", "SavedClips"])
    ap.add_argument("--no-ffmpeg", action="store_true")
    ap.add_argument("--junk", action="store_true", help="add a tiny junk clip to every event")
    a = ap.parse_args()
    made = build(a.dir, a.events, a.minutes, a.kind, use_ffmpeg=not a.no_ffmpeg, junk=a.junk)
    print(f"built {a.events} event(s), {len(made)} clips under {a.dir / 'TeslaCam'}")


if __name__ == "__main__":
    main()
