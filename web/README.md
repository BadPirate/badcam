# badcam web

Receives Tesla camera clips from the Pi (`usb-badcam/`), indexes them in MySQL, stitches the four cameras into one 2x2 video per event with ffmpeg, and serves an owner-only viewer that works on a phone and in the Tesla browser (parked).

Stack: Node 24, pnpm 10, Next.js 16 (App Router, standalone output), Prisma 7 with the MariaDB driver adapter, Tailwind 4, the shared `@kaperkunde/*` packages. The wire protocol is in the [root README](../README.md#protocol).

## Local development

```bash
cd web
pnpm install
cp .env.example .env            # then edit: database URL, OWNER_PASSWORD, SESSION_SECRET, DATA_DIR
pnpm prisma generate            # the client goes to lib/generated (not committed)
pnpm prisma migrate deploy      # or `migrate dev` while changing the schema
pnpm dev                        # http://localhost:3100
```

You need a MySQL or MariaDB database, plus `ffmpeg` and `ffprobe` on the path (and the DejaVu Sans font for the burned-in labels; override the path with `FONT_FILE`). The quickest database is the bundled one: `MYSQL_PASSWORD=... MYSQL_ROOT_PASSWORD=... OWNER_PASSWORD=... SESSION_SECRET=... docker compose -f docker-compose.local.yaml up`.

Create a device token, make test footage and push it:

```bash
pnpm -s tsx scripts/create-device.ts mycar                 # prints the token once
bash scripts/make-fixtures.sh ./fixtures                   # two fake Sentry events
pnpm -s tsx scripts/push-fixtures.ts ./fixtures http://127.0.0.1:3100 <token>
```

Checks: `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build`. The integration test in `lib/integration.test.ts` runs when `DATABASE_URL` is set (or `.env` exists) and ffmpeg is installed; it uses its own temporary data directory and cleans up its rows.

## Environment

| Variable                                                          | Default     | Meaning                                                                      |
| ----------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------- |
| `DATABASE_URL`                                                    | required    | `mysql://user:password@host:3306/database`                                   |
| `OWNER_PASSWORD`                                                  | required    | the one viewer password, at least 12 characters                              |
| `SESSION_SECRET`                                                  | required    | signs the session cookie, at least 32 characters (`openssl rand -base64 48`) |
| `DATA_DIR`                                                        | `/data`     | clips live here (one volume)                                                 |
| `RETAIN_SENTRY_DAYS` / `RETAIN_SAVED_DAYS` / `RETAIN_RECENT_DAYS` | 30 / 90 / 7 | delete an event this long after it started; 0 keeps forever                  |
| `RETAIN_ORIGINALS_DAYS`                                           | 14          | delete the original clips this long after a successful stitch; 0 keeps them  |
| `MIN_FREE_GB`                                                     | 5           | the disk guard frees space below this; uploads get 507 below 1 GiB           |
| `STITCH_FPS` / `STITCH_CRF`                                       | 24 / 26     | output frame rate and quality                                                |
| `STITCH_MIRROR`                                                   | `none`      | `back` or `rear_all` flips rear-facing cameras                               |
| `HIGHLIGHT`                                                       | `false`     | also make a motion-only highlight video                                      |
| `FONT_FILE`                                                       | DejaVu Sans | font for the labels                                                          |

The app refuses to start in production when a secret is missing or short, the database schema is behind the build, or `DATA_DIR` is not writable.

## How it works

- **Upload** (`lib/upload/receive.ts`): chunks are streamed to `DATA_DIR/incoming/<device>/<hash>.part`, verified by sha256 on the last chunk, then renamed into `DATA_DIR/originals/<device>/<path>`. Re-sending a finished file is a no-op, a wrong offset answers 409 with the real one, and files of events the owner deleted count as complete so the Pi never re-uploads them. There is deliberately no `proxy.ts` or middleware: request bodies stream straight to disk.
- **Timestamps** are car-local with no zone. They are stored as if UTC and always shown as written by the car.
- **Stitching** (`lib/stitch/`): when the Pi reports an event complete (or 30 minutes after its last upload), each camera-minute becomes a 1280x960 2x2 segment (H.264, labels and clock burned in, a missing camera becomes a black tile), the segments are joined without re-encoding into `event.mp4`, and a poster is taken from `thumb.png` or a frame near the trigger. One ffmpeg runs at a time, niced.
- **Jobs** run inside the app (`lib/jobs/`), once per run even with several replicas: `stitch-sweep` every 5 minutes, `retention` daily at 03:17 Europe/Amsterdam, `disk-guard` hourly. Starred events are never removed. Deleting an event leaves a small tombstone row for 60 days.
- **Auth**: one owner password and a signed 30-day cookie for the viewer; per-device bearer tokens (shown once under Settings, stored as sha256) for the Pi.

## Deploying (generic, Docker Compose)

1. Create a database and user on a MySQL 8 or MariaDB server, or use `docker-compose.local.yaml`, which brings its own MySQL.
2. Point your platform at this directory (`web/`) with `docker-compose.yaml`. The `migrate` service applies migrations and exits; `web` starts after it succeeds. Make the database reachable from both services under the host name used in `DATABASE_URL`.
3. Set `DATABASE_URL`, `OWNER_PASSWORD`, `SESSION_SECRET` (and any optional overrides). Route your domain to container port 3000; TLS terminates at the proxy.
4. Keep the `badcam-data` volume persistent and never rename its key after the first deploy. Size it for your retention settings (a Sentry event is roughly 1 GB of originals for 14 days, then about 10 MB per minute).
5. Do not add external schedulers; the in-app jobs are enough. The log shows `[scheduler] Started: stitch-sweep, retention, disk-guard` at boot.
6. Open the site, sign in, add a device under Settings, and put the site URL and the token in the Pi's config. Smoke-test with `push-fixtures.ts`.

Swapping the default database: `docker-compose.yaml` expects an external database, `docker-compose.local.yaml` bundles one. To switch which one a platform picks up by default, rename the files; nothing else changes.
