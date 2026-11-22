import os
import stat

from badcam import wifi
from badcam.config import Config, WifiCfg


def cfg_with(*nets):
    c = Config()
    c.wifi = list(nets)
    return c


def test_writes_one_file_per_network_with_mode_0600(tmp_path):
    cfg = cfg_with(WifiCfg("HomeNet", "secret-home", 20), WifiCfg("Office", "secret-off", 10, upload=False))
    written, removed = wifi.apply(cfg, tmp_path)
    assert written == ["badcam-1.nmconnection", "badcam-2.nmconnection"] and removed == []
    f = tmp_path / "badcam-1.nmconnection"
    assert stat.S_IMODE(os.stat(f).st_mode) == 0o600
    text = f.read_text()
    assert "ssid=HomeNet" in text and "psk=secret-home" in text and "autoconnect-priority=20" in text
    assert "type=wifi" in text and "key-mgmt=wpa-psk" in text
    assert "autoconnect-priority=10" in (tmp_path / "badcam-2.nmconnection").read_text()


def test_prunes_stale_badcam_files_but_keeps_others(tmp_path):
    (tmp_path / "badcam-7.nmconnection").write_text("old")
    (tmp_path / "preconfigured.nmconnection").write_text("from the imager")
    wifi.apply(cfg_with(WifiCfg("HomeNet", "secret-home")), tmp_path)
    names = sorted(p.name for p in tmp_path.iterdir())
    assert names == ["badcam-1.nmconnection", "preconfigured.nmconnection"]


def test_idempotent_and_open_network(tmp_path):
    cfg = cfg_with(WifiCfg("Cafe", ""))
    wifi.apply(cfg, tmp_path)
    first = (tmp_path / "badcam-1.nmconnection").read_text()
    wifi.apply(cfg, tmp_path)
    assert (tmp_path / "badcam-1.nmconnection").read_text() == first
    assert "wifi-security" not in first
