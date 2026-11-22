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


def make(cfg_edit=None, volts=(2.5, 0.0, 1.9, 0.0), fail=False, udc_attached=True):
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


def test_ups_mode_applies_scales_and_thresholds():
    def edit(c):
        c.ups.calibrated = True
        c.ups.vin_scale = 2.0
        c.ups.vbat_scale = 2.0
    mon, plat, _ = make(edit, volts=(2.5, 0, 1.9, 0))
    assert mon.vin_v() == pytest.approx(5.0, abs=0.01)
    assert mon.battery_v() == pytest.approx(3.8, abs=0.01)
    assert mon.car_power() is True
    mon2, _, _ = make(edit, volts=(0.1, 0, 1.9, 0), udc_attached=True)
    assert mon2.car_power() is False  # Vin low wins over a "configured" UDC


def test_udc_fallback_when_not_calibrated():
    mon, plat, _ = make(volts=(0.0, 0, 1.9, 0), udc_attached=True)  # calibrated = false
    assert mon.car_power() is True  # UDC says configured; the ADC is ignored for car power
    plat.car_attached = False
    assert mon.car_power() is False
    # battery voltage is still available for the low-battery rules
    assert mon.battery_v() == pytest.approx(3.8, abs=0.01)


def test_source_udc_never_touches_i2c():
    mon, plat, dev = make(lambda c: setattr(c.power, "source", "udc"))
    mon.car_power()
    assert dev.writes == []


def test_i2c_errors_fall_back_and_battery_is_none():
    def edit(c):
        c.ups.calibrated = True
    mon, plat, _ = make(edit, fail=True, udc_attached=True)
    assert mon.car_power() is True  # fell back to UDC
    assert mon.battery_v() is None  # unknown: low-battery rules are skipped
    plat.car_attached = False
    assert mon.car_power() is False


def test_driver_none():
    mon, plat, dev = make(lambda c: setattr(c.ups, "driver", "none"))
    assert mon.battery_v() is None and mon.vin_v() is None
    assert mon.probe() is None
    assert mon.car_power() is True
