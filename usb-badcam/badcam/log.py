"""Logging: stderr (journald) plus a ring buffer dumped to last-cycle.log."""

from __future__ import annotations

import collections
import logging
import sys
from pathlib import Path

LOGGER = logging.getLogger("badcam")


class RingHandler(logging.Handler):
    def __init__(self, size: int = 200) -> None:
        super().__init__()
        self.lines: collections.deque[str] = collections.deque(maxlen=size)

    def emit(self, record: logging.LogRecord) -> None:
        try:
            self.lines.append(self.format(record))
        except Exception:  # pragma: no cover - logging must never raise
            pass

    def reset(self) -> None:
        self.lines.clear()

    def dump(self, path: Path) -> None:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("\n".join(self.lines) + "\n")
        except OSError:
            pass


RING = RingHandler()


class _Stderr(logging.StreamHandler):
    """Always writes to the current sys.stderr (survives capture and redirects)."""

    def __init__(self) -> None:
        super().__init__(sys.stderr)

    @property  # type: ignore[override]
    def stream(self):
        return sys.stderr

    @stream.setter
    def stream(self, value) -> None:
        pass


def setup(verbose: bool = False) -> None:
    LOGGER.setLevel(logging.DEBUG if verbose else logging.INFO)
    if getattr(LOGGER, "_badcam_ready", False):
        return
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%H:%M:%S")
    stream = _Stderr()
    stream.setFormatter(fmt)
    RING.setFormatter(fmt)
    LOGGER.addHandler(stream)
    LOGGER.addHandler(RING)
    LOGGER.propagate = False
    LOGGER._badcam_ready = True  # type: ignore[attr-defined]


def get() -> logging.Logger:
    return LOGGER
