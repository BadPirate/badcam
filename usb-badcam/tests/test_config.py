from badcam import config

GOOD = {
    "server": {"url": "https://badcam.example.com", "token": "bc_" + "x" * 43},
    "wifi": [{"ssid": "Home", "psk": "12345678", "priority": 20}],
}


def test_defaults_and_valid():
    cfg, problems = config.parse(GOOD)
    assert problems == []
    assert cfg.storage.size_gb == 40 and cfg.storage.upload_recent is False
    assert cfg.power.on_battery_idle == "standby"
    assert cfg.live.enabled and cfg.live.reclaim_eject and cfg.live.reclaim_gb == 8
    assert cfg.ups.address == 0x49 and cfg.ups.calibrated is False


def test_example_file_is_valid():
    from pathlib import Path
    cfg, problems = config.load(Path(__file__).parent.parent / "config" / "badcam.example.toml")
    assert problems == []
    assert len(cfg.wifi) == 2


def test_problems_are_reported():
    bad = {
        "server": {"url": "ftp://x", "token": "nope", "chunk_mb": 99},
        "wifi": [{"ssid": "a", "psk": "short"}, {"ssid": "a", "psk": "12345678"}],
        "storage": {"fs": "ntfs", "min_free_gb": 50, "bogus": 1},
        "power": {"on_battery_idle": "sleep", "source": "magic"},
        "ups": {"vbat_critical_v": 3.9, "vin_channel": 7},
        "live": {"interval_s": 1},
        "extra": {},
    }
    _, problems = config.parse(bad)
    text = "\n".join(problems)
    for needle in ["server.url", "server.token", "chunk_mb", "psk must be", "duplicate ssid",
                   "storage.fs", "min_free_gb", "unknown key 'bogus'", "on_battery_idle", "power.source",
                   "vbat_critical_v", "vin_channel", "interval_s", "unknown section 'extra'"]:
        assert needle in text, needle


def test_wrong_types_and_missing_file(tmp_path):
    _, problems = config.parse({"storage": {"size_gb": "big"}})
    assert any("size_gb must be int" in p for p in problems)
    _, problems = config.load(tmp_path / "missing.toml")
    assert "not found" in problems[0]
    (tmp_path / "bad.toml").write_text("this is = = not toml")
    _, problems = config.load(tmp_path / "bad.toml")
    assert "not valid TOML" in problems[0]


def test_check_config_cli_exit_codes(tmp_path, capsys):
    from badcam.__main__ import main
    assert main(["check-config", "--config", str(tmp_path / "nope.toml")]) == 1
    assert main(["check-config", "--config", "config/badcam.example.toml"]) == 0
