# usb-badcam

The Pi side of badcam 2.0. A Raspberry Pi Zero W pretends to be a USB drive for a Tesla
(dashcam and Sentry clips), then uploads the clips to the badcam web app over Wi-Fi,
deletes them from the drive, and stays alive on a UPS battery long enough to do it.

It is a custom minimal setup, not a teslausb fork: one early systemd unit binds the USB
gadget, one Python 3 daemon (standard library only) does everything else. The gadget
setup is adapted from teslausb (MIT, see `NOTICE`).

## Hardware and wiring

- Raspberry Pi Zero W (v1 is fine), 64 GB high-endurance microSD card (40 GB goes to the cam image, configurable).
- A UPS board with a Li-ion battery. Planned: Alchemy Power Pi-UpTime UPS 2.0 (exact model and battery still to be confirmed, see the bench checklist).
- Wiring:
  1. Car USB port -> UPS power input (so the UPS sees the car's power come and go).
  2. UPS output -> Pi power (header pins or the Pi's "PWR" micro-USB port).
  3. A **separate data cable** from the car to the Pi's "USB" (OTG) micro-USB port, with the **5 V (VBUS) line cut** or a data-only adapter. Otherwise the car's 5 V back-feeds the Pi and hides power loss from the UPS.
- Caveat: some Tesla firmware (2024.32 and later) cuts USB power while Sentry mode is active. No software can make the car write clips when its port is dead; test on your car (bench checklist B7).

## Flashing and install

1. Flash **Raspberry Pi OS Lite 32-bit** (Bookworm or newer) with Raspberry Pi Imager. In the Imager settings set: hostname `usb-badcam`, your SSH public key, and your home Wi-Fi.
2. Boot, SSH in, get this folder onto the Pi (`git clone` the repo, or `scp -r usb-badcam`).
3. `cd usb-badcam && sudo ./install.sh`. It installs packages, turns on I2C and the USB gadget overlay, trims boot, creates the cam image, installs the units, and copies `config/badcam.example.toml` to `/boot/firmware/badcam.toml` if absent.
4. Edit `/boot/firmware/badcam.toml`: `server.url`, `server.token` (from the web app: Settings -> Add device) and any extra `[[wifi]]` networks. `badcam check-config` validates it.
5. `sudo reboot`. Then `badcam status` and `journalctl -u badcam -f`.

The Wi-Fi you set in the Imager stays (it is a separate NetworkManager connection). Entries in `badcam.toml` are added on top at every boot as `badcam-<n>.nmconnection` files; removing an entry removes its file at the next boot (or run `sudo badcam wifi-apply` and `sudo nmcli connection reload`).

The install keeps `avahi-daemon` on so `usb-badcam.local` works; run `BADCAM_MASK_AVAHI=1 sudo ./install.sh` to disable it for a slightly faster boot.

## How it works

States: `RECORDING` (car attached, drive visible), `LIVE_UPLOAD`, `DETACHED_WORK`, `ON_BATTERY_IDLE`.

- **Recording.** The gadget is bound very early at boot (before Wi-Fi, fsck or mounts); the aim is a drive visible to the car within 20 s of power. The daemon only watches power and the clock.
- **Live upload (car attached, e.g. awake at home).** Every `live.interval_s` on a known network the daemon mounts the image **read-only**, uploads events that are complete (`event.json` present, nothing changed for `storage.settle_s`), unmounts, and deletes nothing. Files the server reports as `valid: false` are not recorded (they may have been read mid-write) and are retried later.
- **Detached work (car power lost for `power.debounce_s`).** The gadget is unbound, the image is checked (`fsck`, 120 s cap, failures ignored), mounted read-write, files already uploaded and junk (clips under 100,000 bytes) are deleted, then everything left is uploaded (SavedClips first, then SentryClips, newest first) and each file is deleted after the server confirms it. Empty event folders are removed. If free space is below `storage.min_free_gb` the oldest SentryClips are deleted even if not uploaded (logged as data loss). Then the gadget is bound again. If car power returns mid-cycle the current chunk finishes, the image is unmounted and the gadget rebound; if the battery is low or `power.max_battery_min` is reached the cycle stops.
- **Brief eject.** While the car is attached and awake, once `live.reclaim_gb` (8 GB) of clips are uploaded but not yet deleted, or free space drops below the floor, the daemon briefly unbinds the drive to delete them without uploading. **Side effect: the car sees the drive missing for some seconds** (and may show a USB/dashcam warning). Turn it off with `live.reclaim_eject = false`.
- **After work on battery (`power.on_battery_idle`).**
  - `"standby"` (default): Wi-Fi is switched off and the Pi stays up, so the drive is available instantly when the car wakes. Every 30 min it switches Wi-Fi on for one attempt if files are pending. Battery below `ups.vbat_low_v` -> clean `poweroff`.
  - `"poweroff"`: `systemctl poweroff` straight after the work is done. Only switch to this after bench test B4 proves your UPS cuts power after a halt **and** boots the Pi again when car power returns; otherwise the Pi stays off and the car finds no drive.
- The image is never mounted read-write while the gadget is bound (asserted in the tests).

Only networks with `upload = true` count as "known"; a network with `upload = false` is usable for SSH only. A known network also needs `POST /api/v1/ping` to answer `accepting: true`.

RecentClips (the rolling hour of driving) are not uploaded unless `storage.upload_recent = true`.

## Power sensing

The UPS has no GPIO signal. `badcam/power.py` reads an ADS1015-style 12-bit ADC over I2C (default bus 1, address 0x49). The register map and channel assignment of the Pi-UpTime are not confirmed, so channels, scales and thresholds are config (`[ups]`). Until `ups.calibrated = true`, "car power present" falls back to the USB host state (`/sys/class/udc/*/state == configured`). I2C errors also fall back to it. Battery voltage is `None` when unknown and the low-battery rules are then skipped. Limitation of the fallback: while the gadget is unbound (detached work) the host state cannot show that the car is back, so calibrate the UPS reading (bench test B3) for the best behaviour. The critical-battery shutdown (`ups.vbat_critical_v`) only applies while car power is absent, so a depleted battery that is charging in the car does not power the Pi off.

Calibrate: `sudo badcam probe-ups`, unplug and plug the UPS input and see which channel follows; then set `vin_channel`, `vbat_channel`, scales and `calibrated = true`.

## Config reference (`/boot/firmware/badcam.toml`)

See `config/badcam.example.toml` for every key with its default. Highlights:

| Key | Default | Meaning |
|---|---|---|
| `server.url`, `server.token` | | Site origin and device token |
| `storage.size_gb`, `storage.fs` | 40, `exfat` | Cam image size (set at install; never resized) and filesystem (`vfat` alternative) |
| `storage.upload_recent` | false | Upload RecentClips |
| `storage.min_free_gb` | 4 | Free-space floor |
| `storage.settle_s` | 120 | Live mode: files unchanged this long |
| `power.source` | `auto` | `auto` (UPS once calibrated, else USB state), `ups`, `udc` |
| `power.on_battery_idle` | `standby` | `standby` or `poweroff` |
| `power.max_battery_min` | 45 | Cap on battery work per power loss |
| `live.enabled` | true | Upload while the car is attached |
| `live.reclaim_eject`, `live.reclaim_gb` | true, 8 | Brief eject to free uploaded clips |

## CLI

`python3 -m badcam ...` or `badcam ...`: `run`, `once --mode live|detached`, `status`, `probe-ups`, `wifi-apply`, `check-config`. `--config <path>` and `--fake-root <dir>` (a directory holding `TeslaCam/`, no hardware touched) work on every command.

## Development (no Pi needed)

```bash
make check   # pytest, shellcheck, compileall
make demo    # fake TeslaCam tree + mock server + one detached cycle
python3 tools/mock_server.py --port 8787 --data /tmp/badcam-mock   # implements the web API v1
python3 tools/make_fake_teslacam.py /tmp/fake --events 3 --minutes 2
```

Python 3.11+, standard library only at runtime. All system effects go through `badcam/platform.py` (`LinuxPlatform`, `FakePlatform`).

## Troubleshooting

- Drive not seen by the car: `badcam status`, `/opt/badcam/gadget.sh status` (expect `configured`), `dmesg | grep badcam`, check `dtoverlay=dwc2` in `config.txt` and that the cable is a data cable in the "USB" port.
- Nothing uploads: `badcam status` (SSID must be an `upload = true` network), `journalctl -u badcam`, `/var/lib/badcam/last-cycle.log`. A 401 backs off 10 minutes; 507 (server full) 30 minutes and deletes nothing.
- Wi-Fi: `nmcli connection show`, `ls /etc/NetworkManager/system-connections/`.
- Boot time: `systemd-analyze`, `dmesg | grep "badcam: gadget bound"`. Further trimming: `BADCAM_MASK_AVAHI=1`, a Zero 2 W, read-only root (not done).
- Reclaim a stuck image: `sudo systemctl stop badcam; sudo /opt/badcam/gadget.sh down; sudo umount /mnt/badcam-cam; sudo losetup -D`.

## Licence

MIT, see `../LICENSE`; the gadget setup is adapted from teslausb (MIT), see `NOTICE`.
