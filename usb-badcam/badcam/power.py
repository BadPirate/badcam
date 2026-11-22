"""Power sensing: ADS1015-style I2C reader (UPS) with a USB host-state fallback.

The Pi-UpTime UPS 2.0 exposes a 12-bit ADC at I2C 0x49. Its register map was
not available when this was written, so the driver is a generic ADS1015
single-shot reader and the channel numbers and scales are config. Run
`badcam probe-ups` on the bench to find them (docs/BENCH-TEST.md, B3).
"""

from __future__ import annotations

import fcntl
import os
import time
from typing import Callable, Protocol

from . import log
from .config import Config, UpsCfg
from .platform import Platform

I2C_SLAVE = 0x0703
REG_CONVERSION = 0x00
REG_CONFIG = 0x01
PGA_4V096 = 0b001  # +/-4.096 V full scale
FULL_SCALE_V = 4.096


class I2CDevice(Protocol):
    def write(self, data: bytes) -> None: ...
    def read(self, n: int) -> bytes: ...
    def close(self) -> None: ...


class LinuxI2C:
    def __init__(self, bus: int, address: int) -> None:
        self.fd = os.open(f"/dev/i2c-{bus}", os.O_RDWR)
        fcntl.ioctl(self.fd, I2C_SLAVE, address)

    def write(self, data: bytes) -> None:
        os.write(self.fd, data)

    def read(self, n: int) -> bytes:
        return os.read(self.fd, n)

    def close(self) -> None:
        os.close(self.fd)


def config_word(channel: int) -> int:
    """Single-shot start, MUX AINx-GND, PGA +/-4.096 V, 1600 SPS, comparator off."""
    return (1 << 15) | ((0b100 + channel) << 12) | (PGA_4V096 << 9) | (1 << 8) | (0b100 << 5) | 0b11


def raw_to_volts(raw16: int) -> float:
    """ADS1015: signed 16-bit register, 12-bit result left-aligned."""
    if raw16 & 0x8000:
        raw16 -= 0x10000
    return (raw16 >> 4) * FULL_SCALE_V / 2048.0


class Ads1015:
    def __init__(self, dev: I2CDevice, sleep: Callable[[float], None] = time.sleep) -> None:
        self.dev = dev
        self.sleep = sleep

    def read_volts(self, channel: int) -> float:
        word = config_word(channel)
        self.dev.write(bytes([REG_CONFIG, word >> 8, word & 0xFF]))
        for _ in range(20):
            self.sleep(0.002)
            self.dev.write(bytes([REG_CONFIG]))
            cfg = self.dev.read(2)
            if cfg[0] & 0x80:  # OS bit: conversion finished
                break
        self.dev.write(bytes([REG_CONVERSION]))
        data = self.dev.read(2)
        return raw_to_volts((data[0] << 8) | data[1])

    def read_all(self) -> list[float]:
        return [self.read_volts(c) for c in range(4)]


class PowerSource(Protocol):
    def car_power(self) -> bool: ...
    def vin_v(self) -> float | None: ...
    def battery_v(self) -> float | None: ...


class PowerMonitor:
    """Decides "car power present" and exposes battery voltage."""

    def __init__(
        self,
        cfg: Config,
        platform: Platform,
        opener: Callable[[UpsCfg], I2CDevice] | None = None,
    ) -> None:
        self.cfg = cfg
        self.platform = platform
        self.opener = opener or (lambda u: LinuxI2C(u.bus, u.address))
        self._adc: Ads1015 | None = None
        self._last_err_log = -1e9

    def _use_ups(self) -> bool:
        u, p = self.cfg.ups, self.cfg.power
        if u.driver == "none" or p.source == "udc":
            return False
        return p.source == "ups" or (p.source == "auto" and u.calibrated)

    def trusted(self) -> bool:
        """True when 'car power' comes from the calibrated UPS, not the USB-host fallback."""
        return self._use_ups()

    def _adc_or_none(self) -> Ads1015 | None:
        if self.cfg.ups.driver == "none":
            return None
        if self._adc is None:
            try:
                self._adc = Ads1015(self.opener(self.cfg.ups))
            except OSError as exc:
                self._warn(f"cannot open I2C: {exc}")
                return None
        return self._adc

    def _warn(self, msg: str) -> None:
        now = self.platform.now()
        if now - self._last_err_log >= 60:
            self._last_err_log = now
            log.get().warning("power: %s", msg)

    def _volts(self, channel: int, scale: float) -> float | None:
        adc = self._adc_or_none()
        if adc is None:
            return None
        try:
            return adc.read_volts(channel) * scale
        except OSError as exc:
            self._adc = None
            self._warn(f"I2C error: {exc}")
            return None

    def vin_v(self) -> float | None:
        u = self.cfg.ups
        return self._volts(u.vin_channel, u.vin_scale)

    def battery_v(self) -> float | None:
        u = self.cfg.ups
        return self._volts(u.vbat_channel, u.vbat_scale)

    def car_power(self) -> bool:
        if self._use_ups():
            vin = self.vin_v()
            if vin is not None:
                return vin >= self.cfg.ups.vin_present_v
            self._warn("falling back to USB host state")
        return self.platform.udc_state() == "configured"

    def probe(self) -> list[float] | None:
        adc = self._adc_or_none()
        if adc is None:
            return None
        return adc.read_all()


class FakePower:
    """Scripted power for tests and fake-root runs."""

    def __init__(self, car: bool = True, vbat: float | None = 4.0) -> None:
        self.car = car
        self.vbat = vbat
        self.car_fn: Callable[[], bool] | None = None
        self.vbat_fn: Callable[[], float | None] | None = None

    def car_power(self) -> bool:
        return self.car_fn() if self.car_fn else self.car

    def vin_v(self) -> float | None:
        return 5.1 if self.car_power() else 0.0

    def battery_v(self) -> float | None:
        return self.vbat_fn() if self.vbat_fn else self.vbat
