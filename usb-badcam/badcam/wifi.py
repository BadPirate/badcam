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
        "",
    ]
    if net.psk:
        lines += ["[wifi-security]", "key-mgmt=wpa-psk", f"psk={net.psk}", ""]
    lines += ["[ipv4]", "method=auto", "", "[ipv6]", "method=auto", ""]
    return "\n".join(lines)


def apply(cfg: Config, directory: str | Path = NM_DIR) -> tuple[list[str], list[str]]:
    """Write badcam-<n>.nmconnection per entry (mode 0600); delete other badcam-* files."""
    d = Path(directory)
    d.mkdir(parents=True, exist_ok=True)
    wanted: dict[str, str] = {}
    for i, net in enumerate(cfg.wifi, 1):
        wanted[f"{PREFIX}{i}.nmconnection"] = render(i, net)
    removed: list[str] = []
    for p in d.glob(f"{PREFIX}*.nmconnection"):
        if p.name not in wanted:
            p.unlink()
            removed.append(p.name)
    written: list[str] = []
    for name, text in wanted.items():
        p = d / name
        tmp = d / (name + ".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as fh:
            fh.write(text)
        os.chmod(tmp, 0o600)
        os.replace(tmp, p)
        written.append(name)
    return written, removed
