#!/usr/bin/env bash
# Builds a small TeslaCam/ tree for end-to-end tests.
# Usage: scripts/make-fixtures.sh <dir>
# Two Sentry events of two 2-second minutes each, 1280x960 at 36 fps;
# the second event is missing the right repeater in its second minute.
set -euo pipefail

dir=${1:?usage: make-fixtures.sh <dir>}
command -v ffmpeg >/dev/null || { echo "ffmpeg is required" >&2; exit 1; }
root="$dir/TeslaCam/SentryClips"
rm -rf "$dir/TeslaCam"

clip() {
  # clip <output> <seed>
  ffmpeg -hide_banner -loglevel error -y -nostdin \
    -f lavfi -i "testsrc2=s=1280x960:r=36:d=2:alpha=0" \
    -vf "hue=h=$2" -c:v libx264 -preset ultrafast -crf 30 -pix_fmt yuv420p -an "$1"
}

event() {
  # event <folder> <trigger timestamp> <minute>... ; a minute may be written "HH-MM-SS:skip-camera"
  local folder=$1 trigger=$2
  shift 2
  mkdir -p "$root/$folder"
  printf '{"timestamp":"%s","city":"Amsterdam","est_lat":"52.3676","est_lon":"4.9041","reason":"sentry_aware_object_detection","camera":"0"}\n' \
    "$trigger" >"$root/$folder/event.json"
  ffmpeg -hide_banner -loglevel error -y -nostdin -f lavfi -i "testsrc2=s=1280x960:d=1" -frames:v 1 "$root/$folder/thumb.png"
  local seed=0 spec minute skip cam
  for spec in "$@"; do
    minute=${spec%%:*}
    skip=""
    [[ $spec == *:* ]] && skip=${spec#*:}
    for cam in front back left_repeater right_repeater; do
      seed=$((seed + 20))
      [[ $cam == "$skip" ]] && continue
      clip "$root/$folder/${folder%%_*}_${minute}-${cam}.mp4" "$seed"
    done
  done
}

event 2026-11-20_18-22-10 2026-11-20T18:22:10 18-20-10 18-21-10
event 2026-11-21_09-05-33 2026-11-21T09:05:33 09-04-33 09-05-33:right_repeater

echo "fixtures in $root"
find "$root" -type f | wc -l
