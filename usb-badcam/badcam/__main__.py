"""CLI: run, once, status, probe-ups, wifi-apply, check-config."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from . import __version__, log, wifi
from .config import DEFAULT_CONFIG_PATH, Config, load
from .daemon import Daemon
from .platform import FakePlatform, LinuxPlatform
from .power import FakePower, PowerMonitor
from .state import State

LAST_CYCLE_LOG = Path("/var/lib/badcam/last-cycle.log")


def build(cfg: Config, fake_root: str | None, car: bool = False):
    if fake_root:
        root = Path(fake_root)
        platform = FakePlatform(root)
        platform.sleep = lambda s: None  # type: ignore[method-assign]
        platform.car_attached = car
        power = FakePower(car=car, vbat=4.0)
        state = State(root / ".badcam-state.db")
        return platform, power, state, None
    platform = LinuxPlatform(cfg)
    power = PowerMonitor(cfg, platform)
    state = State(cfg.storage.state_db)
    return platform, power, state, LAST_CYCLE_LOG


def cmd_check_config(args: argparse.Namespace) -> int:
    cfg, problems = load(args.config)
    for p in problems:
        print(f"problem: {p}")
    if problems:
        return 1
    print(f"config OK: {len(cfg.wifi)} wifi network(s), server {cfg.server.url}, "
          f"idle mode {cfg.power.on_battery_idle}, ups calibrated={cfg.ups.calibrated}")
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    cfg, problems = load(args.config)
    if problems:
        for p in problems:
            log.get().error("config: %s", p)
        return 1
    platform, power, state, lcl = build(cfg, args.fake_root)
    Daemon(cfg, platform, power, state, last_cycle_log=lcl).run()
    return 0


def cmd_once(args: argparse.Namespace) -> int:
    cfg, problems = load(args.config)
    if problems:
        for p in problems:
            log.get().error("config: %s", p)
        return 1
    platform, power, state, lcl = build(cfg, args.fake_root, car=args.mode == "live")
    daemon = Daemon(cfg, platform, power, state, last_cycle_log=lcl)
    if args.fake_root:
        daemon.stability.settle_s = 0
    print(daemon.once(args.mode))
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    cfg, _ = load(args.config)
    if args.fake_root:
        state = State(Path(args.fake_root) / ".badcam-state.db")
        platform, power = FakePlatform(args.fake_root), FakePower()
    else:
        state = State(cfg.storage.state_db)
        platform = LinuxPlatform(cfg)
        power = PowerMonitor(cfg, platform)
    raw = state.get_meta("status")
    out = json.loads(raw) if raw else {"state": "unknown (daemon has not reported yet)"}
    out["uploaded_files_recorded"] = state.count()
    out["car_power"] = power.car_power()
    out["udc_state"] = platform.udc_state()
    out["ssid"] = platform.current_ssid()
    vin = getattr(power, "vin_v", lambda: None)()
    out["vin_v"] = None if vin is None else round(vin, 3)
    vbat = power.battery_v()
    out["battery_v"] = None if vbat is None else round(vbat, 3)
    out["ups_calibrated"] = cfg.ups.calibrated
    print(json.dumps(out, indent=2))
    return 0


def cmd_probe(args: argparse.Namespace) -> int:
    cfg, _ = load(args.config)
    mon = PowerMonitor(cfg, LinuxPlatform(cfg))
    print(f"Probing I2C bus {cfg.ups.bus} address {cfg.ups.address:#04x}; Ctrl-C to stop.")
    print("Raw ADC volts per channel (scales not applied). Unplug/plug the UPS input and watch.")
    n = 0
    try:
        while args.count == 0 or n < args.count:
            vals = mon.probe()
            if vals is None:
                print("cannot read the ADC (is I2C enabled? try: i2cdetect -y 1)")
                return 1
            print(time.strftime("%H:%M:%S"), "  ".join(f"A{i}={v:6.3f} V" for i, v in enumerate(vals)), flush=True)
            n += 1
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    return 0


def cmd_wifi(args: argparse.Namespace) -> int:
    cfg, problems = load(args.config)
    if problems:
        for p in problems:
            print(f"problem: {p}")
        return 1
    written, removed = wifi.apply(cfg, args.dir)
    print(f"wrote {written}, removed {removed}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="badcam", description=f"badcam {__version__}")
    parser.add_argument("--config", default=DEFAULT_CONFIG_PATH)
    parser.add_argument("--fake-root", default=None, help="use a directory tree instead of the real hardware")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="cmd", required=True)
    for name, fn in (("run", cmd_run), ("status", cmd_status), ("check-config", cmd_check_config)):
        sub.add_parser(name).set_defaults(fn=fn)
    o = sub.add_parser("once")
    o.add_argument("--mode", choices=["live", "detached"], required=True)
    o.set_defaults(fn=cmd_once)
    p = sub.add_parser("probe-ups")
    p.add_argument("--count", type=int, default=0)
    p.set_defaults(fn=cmd_probe)
    w = sub.add_parser("wifi-apply")
    w.add_argument("--dir", default=wifi.NM_DIR)
    w.set_defaults(fn=cmd_wifi)
    # --config/--fake-root also accepted after the subcommand
    for sp in sub.choices.values():
        sp.add_argument("--config", default=argparse.SUPPRESS)
        sp.add_argument("--fake-root", default=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    log.setup(args.verbose)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
