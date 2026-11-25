"""Local SQLite state: which files were uploaded, plus small key/value meta."""

from __future__ import annotations

import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Uploaded:
    path: str
    size: int
    mtime: int
    sha256: str
    valid: bool


class State:
    def __init__(self, path: str | Path) -> None:
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path))
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS uploaded(
              path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime INTEGER NOT NULL,
              sha256 TEXT NOT NULL, valid INTEGER NOT NULL, uploaded_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
            """
        )
        self.db.commit()

    def get(self, path: str) -> Uploaded | None:
        row = self.db.execute(
            "SELECT path,size,mtime,sha256,valid FROM uploaded WHERE path=?", (path,)
        ).fetchone()
        if not row:
            return None
        return Uploaded(row[0], row[1], row[2], row[3], bool(row[4]))

    def record(self, path: str, size: int, mtime: int, sha256: str, valid: bool) -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO uploaded VALUES(?,?,?,?,?,?)",
            (path, size, mtime, sha256, int(valid), int(time.time())),
        )
        self.db.commit()

    def forget(self, path: str) -> None:
        self.db.execute("DELETE FROM uploaded WHERE path=?", (path,))
        self.db.commit()

    def count(self) -> int:
        return self.db.execute("SELECT COUNT(*) FROM uploaded").fetchone()[0]

    def set_meta(self, key: str, value: str) -> None:
        self.db.execute("INSERT OR REPLACE INTO meta VALUES(?,?)", (key, value))
        self.db.commit()

    def get_meta(self, key: str, default: str | None = None) -> str | None:
        row = self.db.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return row[0] if row else default

    def close(self) -> None:
        self.db.close()
