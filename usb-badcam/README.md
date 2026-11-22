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
  1. Power into the shield's own USB-C input (a charger or the car, ~5 V). The Pi's "PWR" micro-USB port stays empty.
  2. Shield output -> Pi power (header pins). The Pi sees the battery through the shield.
  3. A **power-blocking data cable** (VBUS cut, or a data-only adapter) from the car to the Pi's "USB" (OTG) micro-USB port. On the Pi Zero that port's VBUS is tied to the 5 V rail, so a plain cable would back-feed the Pi. The "car is present" signal is this USB link, not the shield input.
- **Power-blocking data cable:** on the Pi Zero the "USB" (data) port's VBUS is wired to the same 5 V rail as "PWR". When the UPS powers the Pi, use a data cable with VBUS cut (or a data-only adapter), otherwise the car's 5 V back-feeds the Pi and the UPS never sees power loss. Powering the Pi through the data port alone (no UPS) works on a bench but then the Pi sees a host and cannot tell car-off from unplugged.
- Caveat: some Tesla firmware (2024.32 and later) cuts USB power while Sentry mode is active. No software can make the car write clips when its port is dead; test on your car (bench checklist B7).

## Flashing and install

1. Flash **Raspberry Pi OS Lite 32-bit** (Bookworm or newer) with Raspberry Pi Imager. In the Imager settings set a hostname of your choice (for example `<hostname>`), your SSH public key, and your home Wi-Fi. The installer never changes the hostname, so an existing Pi keeps its name and `<hostname>.local` keeps working.
2. Boot, SSH in, get this folder onto the Pi (`git clone` the repo, or `scp -r usb-badcam`).
3. `cd usb-badcam && sudo ./install.sh`. It installs packages, turns on I2C and the USB gadget overlay, trims boot, creates the cam image, installs the units, and copies `config/badcam.example.toml` to `/boot/firmware/badcam.toml` if absent.
4. Edit `/boot/firmware/badcam.toml`: `server.url`, `server.token` (from the web app: Settings -> Add device) and any extra `[[wifi]]` networks. `badcam check-config` validates it.
5. `sudo reboot`. Then `badcam status` and `journalctl -u badcam -f`.

The Wi-Fi you set in the Imager stays (it is a separate NetworkManager connection). To make it an upload network without copying its password, list it by name only: `[[wifi]]` with `ssid = "YourHomeNet"` and `upload = true` (no `psk`). If NetworkManager already has a saved connection for that SSID, badcam writes no profile for it and touches nothing; it only counts as a known upload network. Entries in `badcam.toml` are added on top at every boot as `badcam-<n>.nmconnection` files; removing an entry removes its file at the next boot (or run `sudo badcam wifi-apply` and `sudo nmcli connection reload`).

The install keeps `avahi-daemon` on so `<hostname>.local` works; run `BADCAM_MASK_AVAHI=1 sudo ./install.sh` to disable it for a slightly faster boot.

## How it works

States: `RECORDING` (car attached, drive visible), `LIVE_UPLOAD`, `DETACHED_WORK`, `ON_BATTERY_IDLE`.

- **Recording.** The gadget is bound very early at boot (before Wi-Fi, fsck or mounts); the aim is a drive visible to the car within 20 s of power. The daemon only watches power and the clock.
- **Upload whenever there is Wi-Fi (car attached or not).** When a known upload network comes up (polled every 10 s) and also every `live.interval_s`, complete events are uploaded: with the car attached via a **read-only** mount (nothing deleted); without the car, in a detached cycle that deletes each file after the server confirms it. Complete = `event.json` present and nothing changed for `storage.settle_s`. Files the server reports as `valid: false` are not recorded (they may have been read mid-write) and are retried later.
- **Detached work (car power lost for `power.debounce_s`).** The gadget is unbound, the image is checked (`fsck`, 120 s cap, failures ignored; skipped unless the filesystem's dirty flag is set or `storage.fsck_every_days` have passed, because a full check of a 20 GB image takes about 6 minutes on a Zero W; `storage.fsck = "always"|"never"` overrides), mounted read-write, files already uploaded and junk (clips under 100,000 bytes) are deleted, then everything left is uploaded (SavedClips first, then SentryClips, newest first) and each file is deleted after the server confirms it. Empty event folders are removed. If free space is below `storage.min_free_gb` the oldest SentryClips are deleted even if not uploaded (logged as data loss). Then the gadget is bound again. If car power returns mid-cycle the current chunk finishes, the image is unmounted and the gadget rebound; if the battery is low or `power.max_battery_min` is reached the cycle stops.
- **Brief eject (deleting while the car is attached).** Two writers on one FAT disk are unsafe, so deleting uploaded-and-verified files needs the drive unbound for a moment. It happens as soon as there are such files, **if** the host has written nothing to the image for `delete.quiet_s` (60 s, measured from the image file's modification time) and at most once per `delete.min_interval_min` (15). The sequence is eject, fsck only if the dirty flag is set, delete, re-attach; the log says "drive absent for N s". `live.reclaim_gb` (8 GB) of undeleted data, or free space below the floor, is a force trigger that still waits for write-quiet, but after `delete.max_wait_min` (120) it ejects anyway. **Trade-off: the car sees the drive missing for a few seconds** (and may show a USB/dashcam warning); gating on write-quiet keeps that away from active recording. Turn it off with `live.reclaim_eject = false`.
- **After work on battery (`power.on_battery_idle`).**
  - `"standby"` (default): the Pi stays up so the drive is available instantly when the car wakes. `power.standby_wifi` decides whether Wi-Fi stays on (`"on"`, default until you have done a full car test, so SSH keeps working) or is switched off to save power (`"off"`; then every 30 min it switches Wi-Fi on for one attempt if files are pending). Battery below `ups.vbat_low_v` -> clean `poweroff`.
  - `"poweroff"`: `systemctl poweroff` straight after the work is done. Only switch to this after bench test B4 proves your UPS cuts power after a halt **and** boots the Pi again when car power returns; otherwise the Pi stays off and the car finds no drive. **A halted Pi cannot be woken by USB**: with the UPS keeping it powered it simply stays halted, which is why `standby` is the default. In standby the gadget stays bound (the drive is visible the moment the host returns) and the idle loop checks the USB link every 2 s, returning to recording and switching Wi-Fi back on within seconds.
- The image is never mounted read-write while the gadget is bound (asserted in the tests).

Only networks with `upload = true` count as "known"; a network with `upload = false` is usable for SSH only. A known network also needs `POST /api/v1/ping` to answer `accepting: true`.

RecentClips (the rolling hour of driving) are not uploaded unless `storage.upload_recent = true`.

## Power sensing

"Car present" is the **USB link**: `/sys/class/udc/*/state` is `configured` (or `suspended`, since hosts suspend idle devices). `not attached`, `default`, `powered` and `addressed` count as absent, and only after `power.debounce_s` (20 s). While the gadget is unbound (detached work) the link cannot show the car; after re-binding the daemon waits up to 10 s for the host to enumerate again.

The UPS shield is used for battery and Vin telemetry only. `badcam/power.py` reads its ADC (TLA2024, ADS1015 compatible, I2C bus 1, address 0x48 by jumper, single-shot, +/-6.144 V). Bench-confirmed map: AIN0 = Vin (0 V unpowered, about 5 V powered), AIN1 = battery (the vendor adds 0.2 V: Vbatt = AIN1 + 0.2), AIN2 = Vout (about 5 V), AIN3 = NTC (TempC = (4.236 - V) / 0.0408). All of it is configurable in `[ups]`. `badcam status` and the ping show `vin_v`, `battery_v`, `vout_v`, `temp_c`. Defaults: low battery 3.4 V (stop work, clean shutdown), critical 3.1 V; the critical shutdown is skipped while Vin is above `ups.vin_present_v` (external power). The hardware cuts power below 2.6 V and charges only between 0 and 50 C. The cells are unprotected 18650s (Li-ion default; jumper J4 selects LiFePO4). `power.source = "ups"` (car present by Vin) remains as an option. `ups.calibrated` is ignored. `sudo badcam probe-ups` prints the four raw channels.

## Config reference (`/boot/firmware/badcam.toml`)

See `config/badcam.example.toml` for every key with its default. Highlights:

| Key | Default | Meaning |
|---|---|---|
| `server.url`, `server.token` | | Site origin and device token |
| `storage.size_gb`, `storage.fs` | 40, `exfat` | Cam image size (set at install; never resized) and filesystem (`vfat` alternative) |
| `storage.upload_recent` | false | Upload RecentClips |
| `storage.min_free_gb` | 4 | Free-space floor |
| `storage.settle_s` | 120 | Live mode: files unchanged this long |
| `power.source` | `auto` | `auto`/`udc` (USB link), `ups` (by Vin) |
| `power.on_battery_idle` | `standby` | `standby` or `poweroff` |
| `power.max_battery_min` | 45 | Cap on battery work per power loss |
| `live.enabled` | true | Upload while the car is attached |
| `live.reclaim_eject`, `live.reclaim_gb` | true, 8 | Allow the brief eject; GB of undeleted data that force it |
| `delete.quiet_s`, `delete.min_interval_min`, `delete.max_wait_min` | 60, 15, 120 | Eject gate: host write-quiet time, minimum gap, forced-reclaim max wait |
| `power.standby_wifi` | `on` | Wi-Fi in standby on battery (`off` saves power; test in the car first) |

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

## Recovery (Pi unreachable)

Put the SD card in a laptop and edit `cmdline.txt` on the boot partition: append `systemd.mask=badcam.service systemd.mask=badcam-wifi.service` (space separated, same line). The Pi then boots as stock Raspberry Pi OS. Undo it by removing those words.

- `badcam-gadget.service`: binds the USB drive very early (configfs). No network.
- `badcam-wifi.service`: before NetworkManager, writes `badcam-<n>.nmconnection` files from `badcam.toml`. It is ordering only and always exits 0, so it cannot stop NetworkManager. SSIDs that already have a saved connection are skipped.
- `badcam.service`: the daemon (power, upload, delete). In standby it switches Wi-Fi off only if `power.standby_wifi = "off"`.

The journal is persistent (`SystemMaxUse=32M`, `SyncIntervalSec=60s` so an abrupt battery death loses about a minute of logs at most) so `journalctl -b -1` shows why a boot failed. Trade-off: more SD-card writes than a volatile journal (and a 60 s sync is more frequent than the 5 min default); the cap keeps it small. Set `Storage=volatile` in `/etc/systemd/journald.conf.d/badcam.conf` to go back.

## Reading the logs after a car night

```bash
journalctl -u badcam -b -1 --no-pager          # the previous boot (the night in the car)
journalctl -u badcam --since "yesterday 18:00" # a time window, across boots
journalctl -u badcam -b -1 | grep -E "status\[|ups input|state |car power|drive absent|brief eject"
journalctl -b -1 -p warning                    # warnings and errors from every unit
```

- `status[start|periodic|ups-input] state=... usb=... vin=... vbatt=... vout=... temp=... wifi=... pending=... undeleted_mb=... uptime=...`: one snapshot at daemon start, every `log.status_interval_min` (15) minutes, and at each UPS input change. `usb=configured` means the car's host is talking to the drive, `not attached` means no host. `vin` is the shield input, `vbatt` the battery, `temp` the shield NTC. `previous run's last status:` at start repeats the last snapshot of the run before.
- `ups input lost` / `ups input restored` (with Vin, Vbatt, USB state): the shield's power input crossed 3.8 V / 4.5 V for 5 s. Logged only; it does not change behaviour (the car signal is the USB link). If it says lost when you expected the car to be on, the car cut USB power (for example Sentry cut-off).
- `state RECORDING -> DETACHED_WORK`: the USB link was lost for `power.debounce_s`; the daemon is doing upload and delete work. `ON_BATTERY_IDLE` is standby. `LIVE_UPLOAD` is a read-only upload with the car attached.
- `upload network connected: uploading now`: Wi-Fi arrival trigger. `live scan: N events, M stable` shows what was complete.
- `reclaiming space: brief eject` and `drive absent for N s`: the car-side cost of deleting while attached.
- `fsck skipped` / `running fsck (...)`, `work done on battery: standby`, `battery low`, `critical`: why the Pi idled or shut down. The log ends abruptly at the last minute if the battery died (the last `status[...]` line shows the final Vbatt).
- `/var/lib/badcam/last-cycle.log` holds the full log of the last upload or delete cycle.

## Licence

MIT, see `../LICENSE`; the gadget setup is adapted from teslausb (MIT), see `NOTICE`.
