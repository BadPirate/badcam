#!/bin/bash
# Install badcam on top of a stock Raspberry Pi OS Lite 32-bit (Bookworm or newer).
# Idempotent. Run as root on the Pi:  sudo ./install.sh   (add --force to run on a non-ARM host)
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -h | --help)
      echo "usage: sudo ./install.sh [--force]"
      echo "env: BADCAM_MASK_AVAHI=1 also disables avahi-daemon (saves boot time, loses usb-badcam.local)"
      exit 0
      ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "install.sh must run as root (sudo ./install.sh)" >&2
  exit 1
fi
case "$(uname -m)" in
  arm* | aarch64) ;;
  *)
    if [ "$FORCE" -ne 1 ]; then
      echo "refusing to run on $(uname -m): this installs boot settings for a Raspberry Pi (use --force to override)" >&2
      exit 1
    fi
    ;;
esac

BOOT=/boot/firmware
[ -d "$BOOT" ] || BOOT=/boot
CONF="$BOOT/badcam.toml"
CAMDIR=/var/lib/badcam
OPT=/opt/badcam

say() { echo "==> $*"; }

say "installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y exfatprogs dosfstools parted i2c-tools python3 util-linux

say "installing code to $OPT"
mkdir -p "$OPT"
rm -rf "$OPT/badcam"
cp -r "$HERE/badcam" "$OPT/badcam"
find "$OPT/badcam" -name __pycache__ -prune -exec rm -rf {} +
install -m 0755 "$HERE/system/gadget.sh" "$OPT/gadget.sh"
cat > /usr/local/bin/badcam << 'WRAP'
#!/bin/sh
exec env PYTHONPATH=/opt/badcam python3 -m badcam "$@"
WRAP
chmod 0755 /usr/local/bin/badcam

say "config file"
if [ ! -f "$CONF" ]; then
  install -m 0600 "$HERE/config/badcam.example.toml" "$CONF"
  echo "    wrote $CONF (edit the server token and Wi-Fi networks)"
else
  echo "    keeping existing $CONF"
fi

cfgval() { # cfgval KEY DEFAULT : read [storage] KEY from the config
  python3 - "$CONF" "$1" "$2" << 'PY'
import sys, tomllib
try:
    d = tomllib.load(open(sys.argv[1], "rb")).get("storage", {})
except Exception:
    d = {}
print(d.get(sys.argv[2], sys.argv[3]))
PY
}
SIZE_GB=$(cfgval size_gb 40)
FS=$(cfgval fs exfat)
IMAGE=$(cfgval image /var/lib/badcam/cam.img)
case "$SIZE_GB" in '' | *[!0-9]*)
  echo "storage.size_gb must be a whole number" >&2
  exit 1
  ;;
esac
case "$FS" in exfat | vfat) ;; *)
  echo "storage.fs must be exfat or vfat" >&2
  exit 1
  ;;
esac

say "boot settings ($BOOT/config.txt, cmdline.txt)"
CFGTXT="$BOOT/config.txt"
sed -i '/^# --- badcam (managed by install.sh/,/^# --- end badcam ---/d' "$CFGTXT"
{
  echo
  cat "$HERE/system/config.txt.snippet"
} >> "$CFGTXT"

CMDLINE="$BOOT/cmdline.txt"
line=$(tr -d '\n' < "$CMDLINE")
line=$(echo "$line" | sed -E 's/ ?console=(serial0|ttyAMA0|ttyS0),[0-9]+//g')
for word in quiet fastboot modules-load=dwc2; do
  case " $line " in *" $word "*) ;; *) line="$line $word" ;; esac
done
echo "$line" > "$CMDLINE"
echo "i2c-dev" > /etc/modules-load.d/badcam-i2c.conf

say "disabling services that slow boot or wear the SD card"
MASK="bluetooth hciuart triggerhappy ModemManager keyboard-setup dphys-swapfile apt-daily.timer apt-daily-upgrade.timer man-db.timer"
if [ "${BADCAM_MASK_AVAHI:-0}" = "1" ]; then
  MASK="$MASK avahi-daemon"
fi
for unit in $MASK; do
  if systemctl list-unit-files "$unit.service" "$unit" > /dev/null 2>&1; then
    systemctl disable --now "$unit" > /dev/null 2>&1 || true
    systemctl mask "$unit" > /dev/null 2>&1 || true
  fi
done
swapoff -a 2> /dev/null || true

say "journald: volatile, 16 MB"
mkdir -p /etc/systemd/journald.conf.d
install -m 0644 "$HERE/system/journald-badcam.conf" /etc/systemd/journald.conf.d/badcam.conf

say "cam image $IMAGE (${SIZE_GB} GB, $FS)"
mkdir -p "$(dirname "$IMAGE")" "$CAMDIR"
if [ "$IMAGE" != "$CAMDIR/cam.img" ]; then
  echo "    note: the gadget unit and gadget.sh use /var/lib/badcam/cam.img; set BADCAM_IMAGE in gadget.sh if you moved it" >&2
fi
if [ -f "$IMAGE" ]; then
  echo "    image exists, leaving it alone"
else
  avail_kb=$(df --output=avail -k "$(dirname "$IMAGE")" | tail -1 | tr -d ' ')
  need_kb=$((SIZE_GB * 1024 * 1024 + 2 * 1024 * 1024))
  if [ "$avail_kb" -lt "$need_kb" ]; then
    echo "not enough free space for a ${SIZE_GB} GB image (have $((avail_kb / 1024 / 1024)) GB); lower storage.size_gb in $CONF" >&2
    exit 1
  fi
  fallocate -l "${SIZE_GB}G" "$IMAGE"
  if [ "$FS" = exfat ]; then
    parted -s "$IMAGE" mklabel msdos mkpart primary ntfs 1MiB 100%
  else
    parted -s "$IMAGE" mklabel msdos mkpart primary fat32 1MiB 100%
  fi
  loopdev=$(losetup -P -f --show "$IMAGE")
  udevadm settle --timeout=10 || true
  if [ "$FS" = exfat ]; then
    mkfs.exfat -L TESLACAM "${loopdev}p1"
  else
    mkfs.vfat -F 32 -n TESLACAM "${loopdev}p1"
  fi
  tmp=$(mktemp -d)
  mount "${loopdev}p1" "$tmp"
  mkdir -p "$tmp/TeslaCam"
  umount "$tmp"
  rmdir "$tmp"
  losetup -d "$loopdev"
fi

say "systemd units"
install -m 0644 "$HERE/system/badcam-gadget.service" /etc/systemd/system/
install -m 0644 "$HERE/system/badcam.service" /etc/systemd/system/
install -m 0644 "$HERE/system/badcam-wifi.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable badcam-gadget.service badcam-wifi.service badcam.service

say "checking config"
/usr/local/bin/badcam --config "$CONF" check-config || echo "    fix the problems above in $CONF, then reboot"

if ! systemctl is-active --quiet NetworkManager 2> /dev/null; then
  echo "WARNING: NetworkManager is not active. This image expects Raspberry Pi OS Bookworm or newer (NetworkManager)." >&2
fi

cat << EOM

Done. Next steps:
  1. Edit $CONF: server.url, server.token, and the [[wifi]] entries.
  2. sudo reboot
  3. After boot: badcam status ; journalctl -u badcam -f
  4. Work through docs/BENCH-TEST.md before the Pi goes in the car.
EOM
