"""Power sensing: car presence from the USB link, battery and Vin from the UPS ADC.

The Pi-UpTime UPS 2.0 has a TLA2024 (ADS1015-compatible) at I2C 0x48 (jumper dependent).
Bench-confirmed map: AIN0 = Vin, AIN1 = battery (+0.2 V), AIN2 = Vout, AIN3 = NTC.
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
PGA_6V144 = 0b000  # +/-6.144 V full scale (the UPS 5 V rails read ~5 V and clip at 4.096)
FULL_SCALE_V = 6.144


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
    """Single-shot start, MUX AINx-GND, PGA +/-6.144 V, 1600 SPS, comparator off."""
    return (1 << 15) | ((0b100 + channel) << 12) | (PGA_6V144 << 9) | (1 << 8) | (0b100 << 5) | 0b11


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


PRESENT_STATES = ("configured", "suspended")  # a suspended host is still a connected host
ABSENT_STATES = ("not attached", "default", "powered", "addressed")


def ntc_temp_c(volts: float) -> float:
    """Vendor formula for the Pi-UpTime UPS 2.0 NTC on AIN3."""
    return (4.236 - volts) / 0.0408


class PowerMonitor:
    """"Car present" = the USB link (gadget UDC state). The UPS ADC gives battery and Vin telemetry."""

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

    def _raw(self, channel: int) -> float | None:
        adc = self._adc_or_none()
        if adc is None:
            return None
        try:
            return adc.read_volts(channel)
        except OSError as exc:
            self._adc = None
            self._warn(f"I2C error: {exc}")
            return None

    def vin_v(self) -> float | None:
        u = self.cfg.ups
        v = self._raw(u.vin_channel)
        return None if v is None else v * u.vin_scale

    def battery_v(self) -> float | None:
        u = self.cfg.ups
        v = self._raw(u.vbat_channel)
        return None if v is None else v * u.vbat_scale + u.vbat_offset_v

    def vout_v(self) -> float | None:
        u = self.cfg.ups
        v = self._raw(u.vout_channel)
        return None if v is None else v * u.vout_scale

    def temp_c(self) -> float | None:
        v = self._raw(self.cfg.ups.temp_channel)
        return None if v is None else ntc_temp_c(v)

    def telemetry(self) -> dict[str, float | None]:
        def r(x: float | None, n: int = 2) -> float | None:
            return None if x is None else round(x, n)

        return {
            "vin_v": r(self.vin_v()),
            "battery_v": r(self.battery_v()),
            "vout_v": r(self.vout_v()),
            "temp_c": r(self.temp_c(), 1),
        }

    def car_power(self) -> bool:
        if self.cfg.power.source == "ups":
            vin = self.vin_v()
            if vin is not None:
                return vin >= self.cfg.ups.vin_present_v
            self._warn("Vin unreadable, using the USB link")
        state = self.platform.udc_state()
        if state in ABSENT_STATES:
            return False
        return True  # configured, suspended, or unknown (never detach on a read error)

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

    def telemetry(self) -> dict:
        return {"vin_v": self.vin_v(), "battery_v": self.battery_v(), "vout_v": 5.0, "temp_c": 25.0}

    def battery_v(self) -> float | None:
        return self.vbat_fn() if self.vbat_fn else self.vbat
