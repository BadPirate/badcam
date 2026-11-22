#!/bin/bash
# Bind/unbind the USB mass-storage gadget (configfs). Usage: gadget.sh up|down|status
# The configfs layout is adapted from teslausb run/enable_gadget.sh (MIT), see NOTICE.
set -euo pipefail

IMAGE="${BADCAM_IMAGE:-/var/lib/badcam/cam.img}"
NAME="badcam"
LANG_ID=0x409
CFG=c

configfs_root() {
  local root
  root=$(findmnt -o TARGET -n configfs || true)
  if [ -z "$root" ]; then
    mount -t configfs none /sys/kernel/config
    root=/sys/kernel/config
  fi
  echo "$root"
}

first_udc() {
  find /sys/class/udc -mindepth 1 -maxdepth 1 -printf '%f\n' | head -1
}

prepare() {
  local root gadget
  root=$(configfs_root)
  gadget="$root/usb_gadget/$NAME"
  if [ -d "$gadget" ]; then
    return 0
  fi
  modprobe libcomposite
  mkdir -p "$gadget/configs/$CFG.1"
  echo 0x1d6b > "$gadget/idVendor"   # Linux Foundation
  echo 0x0104 > "$gadget/idProduct"  # Composite Gadget
  echo 0x0100 > "$gadget/bcdDevice"
  echo 0x0200 > "$gadget/bcdUSB"     # USB 2.0
  mkdir -p "$gadget/strings/$LANG_ID" "$gadget/configs/$CFG.1/strings/$LANG_ID"
  echo "badcam-$(sha256sum < /etc/machine-id | cut -c1-16)" > "$gadget/strings/$LANG_ID/serialnumber"
  echo badcam > "$gadget/strings/$LANG_ID/manufacturer"
  echo "badcam drive" > "$gadget/strings/$LANG_ID/product"
  echo "badcam config" > "$gadget/configs/$CFG.1/strings/$LANG_ID/configuration"
  echo 100 > "$gadget/configs/$CFG.1/MaxPower"
  mkdir -p "$gadget/functions/mass_storage.0/lun.0"
  echo 1 > "$gadget/functions/mass_storage.0/lun.0/removable"
  echo 0 > "$gadget/functions/mass_storage.0/lun.0/ro"
  echo 0 > "$gadget/functions/mass_storage.0/lun.0/cdrom"
  echo 0 > "$gadget/functions/mass_storage.0/lun.0/nofua"
  echo "$IMAGE" > "$gadget/functions/mass_storage.0/lun.0/file"
  ln -sf "$gadget/functions/mass_storage.0" "$gadget/configs/$CFG.1"
}

up() {
  local root gadget udc
  prepare
  root=$(configfs_root)
  gadget="$root/usb_gadget/$NAME"
  if [ -n "$(cat "$gadget/UDC")" ]; then
    return 0
  fi
  udc=$(first_udc)
  if [ -z "$udc" ]; then
    echo "badcam: no UDC found (is dtoverlay=dwc2 set?)" >&2
    exit 1
  fi
  echo "$udc" > "$gadget/UDC"
  echo "badcam: gadget bound" > /dev/kmsg 2> /dev/null || true
}

down() {
  local root gadget
  root=$(configfs_root)
  gadget="$root/usb_gadget/$NAME"
  if [ -d "$gadget" ]; then
    echo "" > "$gadget/UDC"
    echo "badcam: gadget unbound" > /dev/kmsg 2> /dev/null || true
  fi
}

status() {
  local f found=0
  for f in /sys/class/udc/*/state; do
    [ -e "$f" ] || continue
    found=1
    cat "$f"
  done
  [ "$found" -eq 1 ] || echo "no-udc"
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  status) status ;;
  *)
    echo "usage: $0 up|down|status" >&2
    exit 2
    ;;
esac
