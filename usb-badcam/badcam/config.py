"""Config loading and validation (TOML, standard library only)."""

from __future__ import annotations

import re
import tomllib
from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import Any

DEFAULT_CONFIG_PATH = "/boot/firmware/badcam.toml"
TOKEN_RE = re.compile(r"^bc_[A-Za-z0-9_-]{43}$")


@dataclass
class ServerCfg:
    url: str = "https://badcam.example.com"
    token: str = ""
    chunk_mb: int = 8


@dataclass
class WifiCfg:
    ssid: str = ""
    psk: str = ""
    priority: int = 10
    upload: bool = True


@dataclass
class StorageCfg:
    image: str = "/var/lib/badcam/cam.img"
    size_gb: int = 40
    fs: str = "exfat"
    upload_recent: bool = False
    min_free_gb: float = 4
    settle_s: int = 120
    fsck: str = "auto"  # auto | always | never
    fsck_every_days: float = 30
    mount_point: str = "/mnt/badcam-cam"
    state_db: str = "/var/lib/badcam/state.db"


@dataclass
class PowerCfg:
    source: str = "auto"
    debounce_s: int = 20
    on_battery_idle: str = "standby"
    max_battery_min: int = 45
    wifi_wait_s: int = 90
    idle_retry_min: int = 30
    standby_wifi: str = "on"  # on | off: Wi-Fi in standby on battery (off saves power; test in the car first)


@dataclass
class UpsCfg:
    driver: str = "ads1015"
    bus: int = 1
    address: int = 0x48
    calibrated: bool = False  # deprecated, ignored (kept so old config files still load)
    vin_channel: int = 0  # shield input (AIN0)
    vbat_channel: int = 1  # battery (AIN1); the vendor adds vbat_offset_v
    vout_channel: int = 2  # shield output (AIN2)
    temp_channel: int = 3  # NTC (AIN3)
    vin_scale: float = 1.0
    vbat_scale: float = 1.0
    vout_scale: float = 1.0
    vbat_offset_v: float = 0.2
    vin_present_v: float = 4.5  # Vin above this = external power (no critical shutdown)
    vbat_low_v: float = 3.4
    vbat_critical_v: float = 3.1


@dataclass
class LiveCfg:
    enabled: bool = True
    interval_s: int = 300
    reclaim_eject: bool = True
    reclaim_gb: float = 8


@dataclass
class DeleteCfg:
    quiet_s: int = 60  # host must not have written to the image for this long before an eject
    min_interval_min: int = 15  # at most one eject per this many minutes
    max_wait_min: int = 120  # forced reclaim (>= live.reclaim_gb or low space) ignores the quiet gate after this


@dataclass
class LogCfg:
    status_interval_min: int = 15  # periodic status line (0 = off)


@dataclass
class Config:
    server: ServerCfg = field(default_factory=ServerCfg)
    wifi: list[WifiCfg] = field(default_factory=list)
    storage: StorageCfg = field(default_factory=StorageCfg)
    power: PowerCfg = field(default_factory=PowerCfg)
    ups: UpsCfg = field(default_factory=UpsCfg)
    live: LiveCfg = field(default_factory=LiveCfg)
    delete: DeleteCfg = field(default_factory=DeleteCfg)
    log: LogCfg = field(default_factory=LogCfg)

    def upload_ssids(self) -> set[str]:
        return {w.ssid for w in self.wifi if w.upload}


def _fill(cls: type, data: dict[str, Any], section: str, problems: list[str]) -> Any:
    known = {f.name: f for f in fields(cls)}
    kwargs: dict[str, Any] = {}
    for key, value in data.items():
        if key not in known:
            problems.append(f"[{section}] unknown key '{key}'")
            continue
        default = getattr(cls(), key)
        want = type(default)
        if want is float and isinstance(value, int) and not isinstance(value, bool):
            value = float(value)
        if want is int and isinstance(value, bool):
            problems.append(f"[{section}] {key} must be a number")
            continue
        if not isinstance(value, want):
            problems.append(f"[{section}] {key} must be {want.__name__}, got {type(value).__name__}")
            continue
        kwargs[key] = value
    return cls(**kwargs)


def parse(data: dict[str, Any]) -> tuple[Config, list[str]]:
    problems: list[str] = []
    cfg = Config()
    for name in ("server", "storage", "power", "ups", "live", "delete", "log"):
        section = data.get(name, {})
        if not isinstance(section, dict):
            problems.append(f"[{name}] must be a table")
            continue
        setattr(cfg, name, _fill(type(getattr(cfg, name)), section, name, problems))
    for key in data:
        if key not in ("server", "wifi", "storage", "power", "ups", "live", "delete", "log"):
            problems.append(f"unknown section '{key}'")
    wifi = data.get("wifi", [])
    if not isinstance(wifi, list):
        problems.append("[[wifi]] must be an array of tables")
        wifi = []
    for i, entry in enumerate(wifi, 1):
        if not isinstance(entry, dict):
            problems.append(f"[[wifi]] #{i} must be a table")
            continue
        cfg.wifi.append(_fill(WifiCfg, entry, f"wifi #{i}", problems))
    problems.extend(validate(cfg))
    return cfg, problems


def validate(cfg: Config) -> list[str]:
    p: list[str] = []
    s = cfg.server
    if not re.match(r"^https?://[^/\s]+", s.url):
        p.append("server.url must start with http:// or https://")
    if s.token and not TOKEN_RE.match(s.token):
        p.append("server.token must look like bc_ followed by 43 base64url characters")
    if not 1 <= s.chunk_mb <= 16:
        p.append("server.chunk_mb must be between 1 and 16")
    seen: set[str] = set()
    for i, w in enumerate(cfg.wifi, 1):
        if not w.ssid or len(w.ssid.encode()) > 32:
            p.append(f"wifi #{i}: ssid must be 1-32 bytes")
        if w.ssid in seen:
            p.append(f"wifi #{i}: duplicate ssid '{w.ssid}'")
        seen.add(w.ssid)
        if w.psk and not 8 <= len(w.psk) <= 63:
            p.append(f"wifi #{i}: psk must be 8-63 characters (or empty for an open network)")
        if any(c in w.ssid + w.psk for c in "\n\r\x00"):
            p.append(f"wifi #{i}: ssid/psk must not contain control characters")
    st = cfg.storage
    if st.fs not in ("exfat", "vfat"):
        p.append("storage.fs must be exfat or vfat")
    if st.size_gb < 1:
        p.append("storage.size_gb must be at least 1")
    if st.min_free_gb < 0 or st.min_free_gb >= st.size_gb:
        p.append("storage.min_free_gb must be >= 0 and smaller than size_gb")
    if st.fsck not in ("auto", "always", "never"):
        p.append("storage.fsck must be auto, always or never")
    if st.fsck_every_days < 0:
        p.append("storage.fsck_every_days must be >= 0")
    if st.settle_s < 0:
        p.append("storage.settle_s must be >= 0")
    pw = cfg.power
    if pw.source not in ("auto", "ups", "udc"):
        p.append("power.source must be auto, ups or udc")
    if pw.on_battery_idle not in ("standby", "poweroff"):
        p.append("power.on_battery_idle must be standby or poweroff")
    if pw.debounce_s < 0 or pw.max_battery_min < 1 or pw.wifi_wait_s < 0:
        p.append("power.debounce_s, max_battery_min and wifi_wait_s must be sensible (>= 0, >= 1, >= 0)")
    u = cfg.ups
    if u.driver not in ("ads1015", "none"):
        p.append("ups.driver must be ads1015 or none")
    if not 0 <= u.address <= 0x7F:
        p.append("ups.address must be a 7-bit I2C address")
    for name in ("vin_channel", "vbat_channel", "vout_channel", "temp_channel"):
        if not 0 <= getattr(u, name) <= 3:
            p.append(f"ups.{name} must be 0-3")
    if u.vbat_critical_v >= u.vbat_low_v:
        p.append("ups.vbat_critical_v must be lower than ups.vbat_low_v")
    if u.vin_scale <= 0 or u.vbat_scale <= 0 or u.vout_scale <= 0:
        p.append("ups scales must be positive")
    if pw.standby_wifi not in ("on", "off"):
        p.append("power.standby_wifi must be on or off")
    if pw.source == "ups" and u.driver == "none":
        p.append("power.source = ups needs ups.driver = ads1015")
    if cfg.log.status_interval_min < 0:
        p.append("log.status_interval_min must be >= 0")
    dl = cfg.delete
    if dl.quiet_s < 0 or dl.min_interval_min < 0 or dl.max_wait_min < 0:
        p.append("delete.* values must be >= 0")
    lv = cfg.live
    if lv.interval_s < 10:
        p.append("live.interval_s must be at least 10")
    if lv.reclaim_gb <= 0:
        p.append("live.reclaim_gb must be positive")
    return p


def load(path: str | Path = DEFAULT_CONFIG_PATH) -> tuple[Config, list[str]]:
    try:
        with open(path, "rb") as fh:
            data = tomllib.load(fh)
    except FileNotFoundError:
        return Config(), [f"config file not found: {path}"]
    except tomllib.TOMLDecodeError as exc:
        return Config(), [f"config file is not valid TOML: {exc}"]
    return parse(data)
