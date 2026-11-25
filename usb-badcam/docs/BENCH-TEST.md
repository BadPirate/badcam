# Bench test (Pi + UPS, before it goes in the car)

**Confirmed on the bench (2026-11-22):** ADC at 0x48; AIN0 = Vin, AIN1 = battery (+0.2 V), AIN2 = Vout, AIN3 = NTC (TempC = (4.236 - V) / 0.0408), +/-6.144 V range. "Car present" is the USB link (`configured`/`suspended`), not Vin. Wiring: power into the shield's own USB-C, Pi "PWR" port empty, power-blocking data cable from the car to the Pi "USB" port. B1 and B3 below are therefore already done; B2 should follow this wiring.

Run these in order on a desk with a laptop as the USB host. Commands run on the Pi unless stated. Tick each one; note results at the bottom, they decide config values.

- [ ] **B1 Identify the hardware.** Which UPS board (full-size Pi-UpTime UPS 2.0 or Pi-Zero-UpTime 2.0), which battery (type, capacity, protected or not), which I2C address jumpers.
  ```bash
  sudo i2cdetect -y 1                 # expect 49 (0x48 / 0x4b are the other jumper settings)
  sudo i2cdump -y 1 0x49 w            # raw words, for the record
  ```
  Photograph the board and battery, write the model and capacity here. If the address is not 0x49, set `ups.address`. **Verify the registers:** the driver assumes a standard ADS1015 (config register 0x01, conversion register 0x00). Check that `sudo badcam probe-ups` (B3) gives stable, plausible voltages. If readings are garbage or constant, the chip or register map differs: stop and report it with the `i2cdump` output.
- [ ] **B2 Wiring.** Car/charger -> UPS power-in; UPS -> Pi power; data cable (5 V cut) from the Pi "USB" port to the laptop.
  - Unplug the UPS input: the Pi must stay up and the laptop must still see the drive (`lsusb`, a new disk on the laptop).
  - Remove the battery and attach only the data cable: the Pi must **not** power up (proves no back-feed).
- [ ] **B3 ADC calibration.**
  ```bash
  sudo badcam probe-ups               # prints A0..A3 once a second; Ctrl-C to stop
  ```
  Plug and unplug the UPS input and note which channel follows input power and which follows the battery. Compare with a multimeter on the 5 V input and the battery terminals to get each scale (`volts = raw * scale`). Edit `/boot/firmware/badcam.toml` `[ups]`: `vin_channel`, `vbat_channel`, `vin_scale`, `vbat_scale`, `vin_present_v`, `calibrated = true`. Restart: `sudo systemctl restart badcam`; then
  ```bash
  badcam status                       # vin_v and battery_v must be sensible; car_power flips when you unplug the input
  ```
- [ ] **B4 Halt and power return (decides `power.on_battery_idle`).** Default is `standby`; switch to `poweroff` only if this passes.
  1. Unplug the UPS input (on battery), then `sudo poweroff`.
  2. Does the UPS cut the Pi's 5 V (LED off, no current)? Note how long it takes.
  3. Re-apply input power. Does the Pi boot by itself? **If yes, `poweroff` is safe. If no, keep `standby`.**
  4. Standby runtime: set `on_battery_idle = "standby"`, unplug the input, let the Pi finish work and idle (`badcam status` shows `ON_BATTERY_IDLE`, Wi-Fi blocked: `rfkill list`), and note how many hours the battery lasts until the clean shutdown at `vbat_low_v`.
- [ ] **B5 Boot time.** Cold power-on with the laptop as host. On the laptop: `dmesg -w` (Linux) or the disk-management view; time from applying power until the drive appears. On the Pi afterwards:
  ```bash
  systemd-analyze
  dmesg | grep "badcam: gadget bound"
  ```
  Target: drive visible within 20 s. If slower see README "Boot time".
- [ ] **B6 Laptop end-to-end.** Copy a few real Tesla clips into `TeslaCam/SentryClips/<YYYY-MM-DD_HH-MM-SS>/` (with `event.json`, `thumb.png` and the `<ts>-<camera>.mp4` files) from the laptop, eject, unplug the UPS input. Watch `journalctl -u badcam -f`: it detaches after `debounce_s`, uploads over home Wi-Fi, the event appears on the site, the drive is empty after re-plugging, and the Pi ends in standby or poweroff as configured. Also copy a clip and leave the input plugged in: the next live cycle (`interval_s`) uploads it but leaves it on the drive.
- [ ] **B7 In the car.** The drive is recognised (dashcam icon, no error). Save a clip with the dashcam icon; it arrives on the site after parking at home. Check whether the port stays powered in Sentry mode and whether Sentry clips are written at all on this firmware; watch for "USB drive too slow" warnings; confirm camera placement and mirroring in the first stitched event on the site. Note any warning shown by the car during a brief eject (`live.reclaim_eject`); set it to `false` if it bothers you.
- [ ] **B8 Second Wi-Fi network.** Add a second `[[wifi]]` to `badcam.toml`, reboot, `nmcli connection show` lists `badcam-1` and `badcam-2`. Uploads work on the second network too. A network with `upload = false` connects (SSH works) but never uploads.
- [ ] **B9 Failure drills.**
  - Pull power mid-upload (resumes at the next opportunity; the site shows no duplicate).
  - Server unreachable (stop the web app or block it): nothing is deleted from the drive, `last-cycle.log` says why.
  - Battery low (let it drain, or raise `vbat_low_v` temporarily): clean shutdown, boots when power returns.

## Results

| Item | Result | Config change |
|---|---|---|
| UPS board / battery | | |
| Vin / Vbat channels and scales | | |
| `on_battery_idle` | | |
| Boot time to drive | | |
| Standby battery hours | | |
| Sentry power in the car | | |
