"""System effects behind one interface so the daemon runs on x86 with a fake."""

from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path
from typing import Callable, Protocol

from . import log
from .config import Config


class Platform(Protocol):
    def gadget_up(self) -> None: ...
    def gadget_down(self) -> None: ...
    def gadget_is_up(self) -> bool: ...
    def udc_state(self) -> str: ...
    def mount_ro(self) -> Path: ...
    def mount_rw(self) -> Path: ...
    def unmount(self) -> None: ...
    def is_mounted(self) -> bool: ...
    def fsck(self) -> None: ...
    def fs_dirty(self) -> bool: ...
    def fsck_age_days(self) -> float | None: ...
    def fsck_stamp(self) -> None: ...
    def image_idle_s(self) -> float | None: ...
    def free_bytes(self) -> int: ...
    def wifi_block(self) -> None: ...
    def wifi_unblock(self) -> None: ...
    def current_ssid(self) -> str | None: ...
    def poweroff(self) -> None: ...
    def now(self) -> float: ...
    def sleep(self, seconds: float) -> None: ...


class LinuxPlatform:
    """Shells out to losetup/mount/fsck/rfkill/nmcli/systemctl."""

    GADGET_SH = "/opt/badcam/gadget.sh"

    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self._loop: str | None = None

    # -- helpers ---------------------------------------------------------
    def _run(self, cmd: list[str], timeout: float = 60, check: bool = True) -> str:
        log.get().debug("run: %s", " ".join(cmd))
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if check and res.returncode != 0:
            raise RuntimeError(f"{' '.join(cmd)} failed ({res.returncode}): {res.stderr.strip()}")
        return res.stdout

    def _attach(self, read_only: bool) -> str:
        cmd = ["losetup", "-P", "-f", "--show"]
        if read_only:
            cmd.append("-r")
        dev = self._run(cmd + [self.cfg.storage.image]).strip()
        self._run(["udevadm", "settle", "--timeout=5"], check=False)
        self._loop = dev
        return dev

    def _detach(self) -> None:
        if self._loop:
            self._run(["losetup", "-d", self._loop], check=False)
            self._loop = None

    # -- gadget ----------------------------------------------------------
    def gadget_up(self) -> None:
        self._run([self.GADGET_SH, "up"], timeout=30)

    def gadget_down(self) -> None:
        self._run([self.GADGET_SH, "down"], timeout=30)

    def gadget_is_up(self) -> bool:
        try:
            return Path("/sys/kernel/config/usb_gadget/badcam/UDC").read_text().strip() != ""
        except OSError:
            return False

    def udc_state(self) -> str:
        for p in sorted(Path("/sys/class/udc").glob("*/state")):
            try:
                return p.read_text().strip()
            except OSError:
                continue
        return "unknown"

    # -- mounts ----------------------------------------------------------
    def _mount(self, read_only: bool) -> Path:
        mp = self.cfg.storage.mount_point
        os.makedirs(mp, exist_ok=True)
        dev = self._attach(read_only) + "p1"
        fstype = "exfat" if self.cfg.storage.fs == "exfat" else "vfat"
        opts = "ro,noatime" if read_only else "rw,noatime"
        try:
            self._run(["mount", "-t", fstype, "-o", opts, dev, mp])
        except Exception:
            self._detach()
            raise
        return Path(mp)

    def mount_ro(self) -> Path:
        return self._mount(True)

    def mount_rw(self) -> Path:
        return self._mount(False)

    def is_mounted(self) -> bool:
        return os.path.ismount(self.cfg.storage.mount_point)

    def unmount(self) -> None:
        if self.is_mounted():
            self._run(["umount", self.cfg.storage.mount_point], timeout=120)
        self._detach()
        # Stale loop devices from a crashed run.
        out = self._run(["losetup", "-j", self.cfg.storage.image], check=False)
        for line in out.splitlines():
            dev = line.split(":", 1)[0]
            if dev:
                self._run(["losetup", "-d", dev], check=False)

    def fsck(self) -> None:
        dev = self._attach(False) + "p1"
        try:
            tool = "fsck.exfat" if self.cfg.storage.fs == "exfat" else "fsck.vfat"
            self._run([tool, "-p" if tool == "fsck.exfat" else "-a", dev], timeout=120, check=False)
        finally:
            self._detach()

    # Partition 1 starts at 1 MiB (see install.sh). The dirty flag is in its boot sector.
    PART_OFFSET = 1024 * 1024

    def fs_dirty(self) -> bool:
        """True if the filesystem's dirty flag is set (or cannot be read: be safe)."""
        try:
            with open(self.cfg.storage.image, "rb") as fh:
                fh.seek(self.PART_OFFSET)
                boot = fh.read(512)
        except OSError:
            return True
        if len(boot) < 512:
            return True
        if boot[3:11] == b"EXFAT   ":
            return bool(int.from_bytes(boot[106:108], "little") & 0x0002)  # VolumeDirty
        return bool(boot[0x41] & 0x01)  # FAT32 "dirty" flag

    def _stamp_path(self) -> str:
        return os.path.join(os.path.dirname(self.cfg.storage.state_db), "last-fsck")

    def fsck_age_days(self) -> float | None:
        try:
            return (time.time() - os.path.getmtime(self._stamp_path())) / 86400
        except OSError:
            return None

    def image_idle_s(self) -> float | None:
        """Seconds since the host last wrote to the image (the gadget writes through the file, so mtime moves)."""
        try:
            return max(0.0, time.time() - os.stat(self.cfg.storage.image).st_mtime)
        except OSError:
            return None

    def fsck_stamp(self) -> None:
        try:
            with open(self._stamp_path(), "w") as fh:
                fh.write(str(time.time()))
        except OSError:
            pass

    def free_bytes(self) -> int:
        st = os.statvfs(self.cfg.storage.mount_point)
        return st.f_bavail * st.f_frsize

    # -- misc ------------------------------------------------------------
    def wifi_block(self) -> None:
        self._run(["rfkill", "block", "wifi"], check=False)

    def wifi_unblock(self) -> None:
        self._run(["rfkill", "unblock", "wifi"], check=False)

    def current_ssid(self) -> str | None:
        try:
            out = self._run(["nmcli", "-t", "-f", "active,ssid", "dev", "wifi"], timeout=10)
        except Exception:
            return None
        for line in out.splitlines():
            if line.startswith("yes:"):
                return line[4:].replace("\\:", ":")
        return None

    def poweroff(self) -> None:
        self._run(["systemctl", "poweroff"], check=False)

    def now(self) -> float:
        return time.monotonic()

    def sleep(self, seconds: float) -> None:
        time.sleep(seconds)


class FakePlatform:
    """Maps the mount point to a directory and records every call.

    `root` holds a `TeslaCam/` tree. `calls` is a list of call names (plus the
    gadget state at the time for mounts) used by tests to assert invariants.
    """

    def __init__(self, root: Path | str, capacity_gb: float = 40, ssid: str | None = "HomeNet") -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.capacity = int(capacity_gb * 1024**3)
        self.ssid = ssid
        self.gadget = True
        self.car_attached = True
        self.mounted: str | None = None
        self.calls: list[str] = []
        self.t = 1000.0
        self.on_sleep: Callable[["FakePlatform"], None] | None = None
        self.on_call: Callable[["FakePlatform", str], None] | None = None
        self.rw_while_gadget_up = 0
        self.poweroffs = 0
        self.wifi_blocked = False
        self.extra_free_bytes: int | None = None
        self.dirty = False
        self.idle_s: float | None = 3600.0
        self.fsck_age: float | None = 0.0

    def _rec(self, name: str) -> None:
        self.calls.append(name)
        if self.on_call:
            self.on_call(self, name)

    def gadget_up(self) -> None:
        self._rec("gadget_up")
        self.gadget = True

    def gadget_down(self) -> None:
        self._rec("gadget_down")
        self.gadget = False

    def gadget_is_up(self) -> bool:
        return self.gadget

    def udc_state(self) -> str:
        return "configured" if (self.gadget and self.car_attached) else "not attached"

    def mount_ro(self) -> Path:
        self._rec("mount_ro")
        self.mounted = "ro"
        return self.root

    def mount_rw(self) -> Path:
        self._rec("mount_rw")
        if self.gadget:
            self.rw_while_gadget_up += 1
        self.mounted = "rw"
        return self.root

    def is_mounted(self) -> bool:
        return self.mounted is not None

    def unmount(self) -> None:
        self._rec("unmount")
        self.mounted = None

    def fsck(self) -> None:
        self._rec("fsck")
        self.fsck_age = 0.0

    def fs_dirty(self) -> bool:
        return self.dirty

    def image_idle_s(self) -> float | None:
        return self.idle_s

    def fsck_age_days(self) -> float | None:
        return self.fsck_age

    def fsck_stamp(self) -> None:
        self.fsck_age = 0.0

    def free_bytes(self) -> int:
        if self.extra_free_bytes is not None:
            return self.extra_free_bytes
        used = 0
        for p in self.root.rglob("*"):
            if p.is_file():
                used += p.stat().st_size
        return max(0, self.capacity - used)

    def wifi_block(self) -> None:
        self._rec("wifi_block")
        self.wifi_blocked = True

    def wifi_unblock(self) -> None:
        self._rec("wifi_unblock")
        self.wifi_blocked = False

    def current_ssid(self) -> str | None:
        return None if self.wifi_blocked else self.ssid

    def poweroff(self) -> None:
        self._rec("poweroff")
        self.poweroffs += 1

    def now(self) -> float:
        return self.t

    def sleep(self, seconds: float) -> None:
        self.t += seconds
        if self.on_sleep:
            self.on_sleep(self)
