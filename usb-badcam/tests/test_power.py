import pytest

from badcam.config import Config
from badcam.platform import FakePlatform
from badcam.power import Ads1015, PowerMonitor, config_word, raw_to_volts


class FakeAds:
    """Fake I2C device behaving like an ADS1015: remembers the pointer register."""

    def __init__(self, volts, fail=False):
        self.volts = volts  # per channel, at the ADC pin
        self.ptr = 0
        self.mux = 0
        self.fail = fail
        self.writes = []

    def write(self, data):
        if self.fail:
            raise OSError("i2c boom")
        self.writes.append(bytes(data))
        self.ptr = data[0]
        if data[0] == 0x01 and len(data) == 3:
            word = (data[1] << 8) | data[2]
            assert word & 0x8000 and word & 0x0100  # start single shot
            self.mux = ((word >> 12) & 0x7) - 4
            assert (word >> 9) & 0x7 == 0b000  # +/-6.144 V

    def read(self, n):
        if self.fail:
            raise OSError("i2c boom")
        if self.ptr == 0x01:
            return bytes([0x80, 0x00])  # conversion ready
        raw = round(self.volts[self.mux] / 6.144 * 2048)
        raw12 = raw & 0xFFF
        word = (raw12 << 4) & 0xFFFF
        return bytes([word >> 8, word & 0xFF])


def make(cfg_edit=None, volts=(5.0, 3.6, 5.0, 2.6), fail=False, udc_attached=True):
    cfg = Config()
    if cfg_edit:
        cfg_edit(cfg)
    plat = FakePlatform("/tmp/badcam-power-test")
    plat.car_attached = udc_attached
    dev = FakeAds(volts, fail)
    mon = PowerMonitor(cfg, plat, opener=lambda u: dev)
    return mon, plat, dev


def test_conversion_maths():
    assert raw_to_volts(0x7FF0) == pytest.approx(6.144 * 2047 / 2048)
    assert raw_to_volts(0x4000) == pytest.approx(3.072)
    assert raw_to_volts(0x0000) == 0
    assert raw_to_volts(0xFFF0) == pytest.approx(-6.144 / 2048)  # -1 LSB
    assert config_word(0) >> 12 == 0b1100
    assert config_word(2) >> 12 == 0b1110


def test_driver_reads_each_channel():
    dev = FakeAds((1.0, 2.0, 3.0, 0.5))
    adc = Ads1015(dev, sleep=lambda s: None)
    got = adc.read_all()
    assert got == pytest.approx([1.0, 2.0, 3.0, 0.5], abs=0.003)


def test_vendor_channel_map_and_scales():
    # AIN0 Vin, AIN1 battery (+0.2 V), AIN2 Vout, AIN3 NTC
    mon, plat, _ = make(volts=(5.0, 3.65, 5.05, 2.6))
    t = mon.telemetry()
    assert t["vin_v"] == pytest.approx(5.0, abs=0.01)
    assert t["battery_v"] == pytest.approx(3.85, abs=0.01)
    assert t["vout_v"] == pytest.approx(5.05, abs=0.01)
    assert t["temp_c"] == pytest.approx((4.236 - 2.6) / 0.0408, abs=0.2)


@pytest.mark.parametrize(
    "state,present",
    [("configured", True), ("suspended", True), ("unknown", True),
     ("not attached", False), ("default", False), ("powered", False), ("addressed", False)],
)
def test_car_present_follows_usb_link_states(state, present):
    mon, plat, _ = make(volts=(0.0, 3.0, 0.0, 0.0))  # Vin 0 V must not matter
    plat.udc_state = lambda: state
    assert mon.car_power() is present


def test_real_sysfs_udc_state(tmp_path, monkeypatch):
    from badcam.config import Config
    from badcam.platform import LinuxPlatform
    import badcam.platform as pm

    d = tmp_path / "udc" / "20980000.usb"
    d.mkdir(parents=True)
    (d / "state").write_text("suspended\n")
    real_path = pm.Path
    monkeypatch.setattr(pm, "Path", lambda x: real_path(str(x).replace("/sys/class/udc", str(tmp_path / "udc"))))
    assert LinuxPlatform(Config()).udc_state() == "suspended"
    (d / "state").write_text("configured\n")
    assert LinuxPlatform(Config()).udc_state() == "configured"


def test_source_ups_uses_vin():
    mon, plat, _ = make(lambda c: setattr(c.power, "source", "ups"), volts=(0.0, 3.0, 0.0, 0.0))
    assert mon.car_power() is False  # Vin 0 V, even though the USB link says configured
    mon2, _, _ = make(lambda c: setattr(c.power, "source", "ups"), volts=(5.0, 3.0, 0.0, 0.0), udc_attached=False)
    assert mon2.car_power() is True


def test_i2c_errors_do_not_affect_car_signal_and_battery_is_none():
    mon, plat, _ = make(fail=True, udc_attached=True)
    assert mon.car_power() is True
    assert mon.battery_v() is None  # unknown: low-battery rules are skipped
    plat.car_attached = False
    assert mon.car_power() is False


def test_driver_none():
    mon, plat, dev = make(lambda c: setattr(c.ups, "driver", "none"))
    assert mon.battery_v() is None and mon.vin_v() is None
    assert mon.probe() is None
    assert mon.car_power() is True
