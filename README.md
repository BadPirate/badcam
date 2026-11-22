# badcam 2.0

Tesla Sentry and dashcam footage, uploaded from the car and watched from anywhere.

Two parts:

- **`usb-badcam/`**: a Raspberry Pi Zero W that presents a USB drive to the car, then uploads and deletes clips over Wi-Fi when the car stops powering it. See [usb-badcam/README.md](usb-badcam/README.md).
- **`web/`**: a Next.js app that receives the clips, stitches the four cameras into one 2x2 video per event, and serves an owner-only viewer. See [web/README.md](web/README.md).

## Architecture

```
 Tesla (USB host) --data--> Pi Zero W: dwc2 gadget, LUN = cam.img (exFAT, "TeslaCam/")
        | 5 V                         |
        +--> UPS --5 V--> Pi          |  badcam daemon (Python)
              | I2C (Vin, Vbat) ------+  RECORDING -> LIVE_UPLOAD (read-only mount, no delete)
              battery                    car power lost -> DETACHED_WORK (unbind, fsck, rw mount,
                                           upload, verify, delete) -> rebind -> standby | poweroff
                                   | HTTPS, bearer token, chunked PUT (see Protocol)
                                   v
 reverse proxy --> web (Next.js, Node 24) --> MySQL (Device, Event, Clip, Segment, JobRun)
                     |  /api/v1/*: receive -> DATA_DIR/incoming -> DATA_DIR/originals
                     |  in-app jobs: stitch-sweep, retention, disk-guard
                     |  ffmpeg: 4 cameras per minute -> segments -> event.mp4 + poster.jpg
                     v
                   DATA_DIR volume --> /media/* (Range) --> phone / Tesla browser (owner cookie)
```

## Quick start

Web (needs Node 24, pnpm, MySQL or MariaDB, ffmpeg): see [web/README.md](web/README.md#local-development). In short: `cd web && pnpm install && cp .env.example .env`, edit it, then `pnpm prisma generate && pnpm prisma migrate deploy && pnpm dev`, and create a device token with `pnpm -s tsx scripts/create-device.ts <name>`.

Pi: flash Raspberry Pi OS Lite 32-bit, then `cd usb-badcam && sudo ./install.sh`, put the site URL and the device token in `/boot/firmware/badcam.toml`, reboot. See [usb-badcam/README.md](usb-badcam/README.md). Without hardware, `make -C usb-badcam demo` runs the daemon against a mock server.

Both parts: `make -C usb-badcam check` and, in `web/`, `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build`.

## Protocol

Base URL from the Pi config (`server.url`). Every request carries `Authorization: Bearer <token>` (format `bc_` + 43 base64url chars). JSON bodies are UTF-8. A file is identified by `(device, path)`.

Path grammar (relative to `TeslaCam/`, forward slashes, each segment percent-encoded in URLs):

```
^(SentryClips|SavedClips)/\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/[A-Za-z0-9._-]{1,80}$
^RecentClips/[A-Za-z0-9._-]{1,80}$
```

Anything else is `400 bad_path`. Event key = the folder name; for RecentClips it is the first 13 characters of the file name (`YYYY-MM-DD_HH`).

### `POST /api/v1/ping`
Body (all optional): `{"version":"2.0.0","state":"RECORDING","car_power":true,"vin_v":5.1,"battery_v":4.05,"free_bytes":123,"pending_files":40}`.
`200 {"ok":true,"device":"<name>","time":"<ISO UTC>","max_chunk_bytes":16777216,"accepting":true}`. `accepting` is false when the server disk is below its floor.

### `POST /api/v1/files/check`
Body `{"files":[{"path":"SentryClips/…/…-front.mp4","size":31457280}, …]}` (max 500).
`200 {"files":[{"path":"…","state":"complete","size":31457280,"sha256":"<hex>"} | {"path":"…","state":"partial","offset":8388608} | {"path":"…","state":"missing","offset":0}]}`.
`complete` is also reported for files of events the owner deleted or whose originals were removed by retention (tombstones), so the Pi never re-uploads them.

### `PUT /api/v1/files/<path>`
Headers: `Content-Range: bytes <start>-<end>/<total>` (required), `Content-Length`, `X-Badcam-Sha256: <hex of the whole file>` (required on the request that contains the last byte), `Content-Type: application/octet-stream`. Chunk size at most `max_chunk_bytes`; the Pi uses 8 MiB.

| Status | Body | Meaning / client action |
|---|---|---|
| 202 | `{"state":"partial","offset":N}` | Chunk appended; continue at N. |
| 201 | `{"state":"complete","sha256":"…","valid":true\|false}` | File stored. `valid` is the server's `ffprobe` verdict for `.mp4`. |
| 200 | same as 201 | An identical complete file already existed. |
| 409 | `{"error":"offset_mismatch","offset":N}` | Resume from N. |
| 422 | `{"error":"sha_mismatch"}` | Partial discarded; restart at 0 (give up after 3 attempts). |
| 400 | `{"error":"bad_path"\|"bad_range"}` | Client bug; skip the file. |
| 401 | `{"error":"unauthorized"}` | Stop the cycle; back off 10 min. |
| 413 | `{"error":"chunk_too_large"}` | Halve the chunk size and retry. |
| 507 | `{"error":"storage_full"}` | Stop the cycle; back off 30 min; delete nothing. |
| 429/503 | optional `Retry-After` | Back off, retry. |

A PUT with `start = 0` always (re)starts the partial. A complete file may be replaced by uploading a different total/sha from offset 0. Zero-length files are not uploaded.

### `POST /api/v1/events/complete`
Body `{"kind":"SentryClips"|"SavedClips","event":"2026-11-20_18-22-10","files":43}`. `200 {"ok":true,"queued":true}`; `404 {"error":"unknown_event"}` if no file of that event was ever stored. Idempotent. The server queues stitching.
