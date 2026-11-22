"""Write NetworkManager keyfiles for the [[wifi]] entries."""

from __future__ import annotations

import os
import uuid
from pathlib import Path

from .config import Config, WifiCfg

NM_DIR = "/etc/NetworkManager/system-connections"
PREFIX = "badcam-"
_NS = uuid.UUID("6f1f0f55-3c1a-4c55-9d3e-0b4d6c1a0001")


def render(index: int, net: WifiCfg) -> str:
    lines = [
        "[connection]",
        f"id={PREFIX}{index}",
        f"uuid={uuid.uuid5(_NS, net.ssid)}",
        "type=wifi",
        f"autoconnect-priority={net.priority}",
        "",
        "[wifi]",
        "mode=infrastructure",
        f"ssid={net.ssid}",
        "powersave=2",
        "",
    ]
    if net.psk:
        lines += ["[wifi-security]", "key-mgmt=wpa-psk", f"psk={net.psk}", ""]
    lines += ["[ipv4]", "method=auto", "", "[ipv6]", "method=auto", ""]
    return "\n".join(lines)


RUN_DIR = "/run/NetworkManager/system-connections"


def valid_entry(net: WifiCfg) -> str | None:
    """Return a problem description, or None if the entry is safe to write."""
    if not net.ssid or len(net.ssid.encode()) > 32:
        return "ssid must be 1-32 bytes"
    if net.psk and not 8 <= len(net.psk) <= 63:
        return "psk must be 8-63 characters"
    if any(c in net.ssid + net.psk for c in "\n\r\x00"):
        return "control characters in ssid/psk"
    return None


def existing_ssids(dirs: list[Path]) -> set[str]:
    """SSIDs of saved NetworkManager profiles that badcam did not write (Imager/netplan/nmtui)."""
    found: set[str] = set()
    for d in dirs:
        try:
            files = list(d.glob("*"))
        except OSError:
            continue
        for p in files:
            if p.name.startswith(PREFIX):
                continue
            try:
                text = p.read_text(errors="replace")
            except OSError:
                continue
            in_wifi = False
            for line in text.splitlines():
                line = line.strip()
                if line.startswith("["):
                    in_wifi = line == "[wifi]"
                elif in_wifi and line.startswith("ssid="):
                    found.add(line[5:])
    return found


def apply(
    cfg: Config,
    directory: str | Path = NM_DIR,
    existing_dirs: list[str | Path] | None = None,
) -> tuple[list[str], list[str]]:
    """Write badcam-<n>.nmconnection (mode 0600) for entries without a saved profile.

    Never raises: bad entries are logged and skipped. An SSID that already has a saved
    NetworkManager profile is left alone (no new profile, no priority change); it still counts
    as a known upload network because the daemon matches on SSID only. Other badcam-* files
    are deleted."""
    d = Path(directory)
    dirs = [d] + [Path(x) for x in (existing_dirs if existing_dirs is not None else [RUN_DIR])]
    try:
        have = existing_ssids(dirs)
    except Exception as e:  # pragma: no cover
        print(f"warning: could not scan existing Wi-Fi profiles: {e}")
        have = set()
    wanted: dict[str, str] = {}
    for i, net in enumerate(cfg.wifi, 1):
        bad = valid_entry(net)
        if bad:
            print(f"warning: wifi #{i} skipped: {bad}")
            continue
        if net.ssid in have:
            print(f"note: wifi #{i} '{net.ssid}' already has a saved connection; using it as is")
            continue
        wanted[f"{PREFIX}{i}.nmconnection"] = render(i, net)
    removed: list[str] = []
    written: list[str] = []
    try:
        d.mkdir(parents=True, exist_ok=True)
        for p in d.glob(f"{PREFIX}*.nmconnection"):
            if p.name not in wanted:
                p.unlink()
                removed.append(p.name)
    except OSError as e:
        print(f"warning: could not prune old profiles: {e}")
    for name, text in wanted.items():
        try:
            p = d / name
            tmp = d / (name + ".tmp")
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as fh:
                fh.write(text)
            os.chmod(tmp, 0o600)
            os.replace(tmp, p)
            written.append(name)
        except OSError as e:
            print(f"warning: could not write {name}: {e}")
    return written, removed
