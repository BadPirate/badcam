// Needs a database (DATABASE_URL, or ./.env) and ffmpeg. Skipped otherwise.
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

try {
  process.loadEnvFile(".env")
} catch {
  // no .env file
}

const haveFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
})()
const enabled = Boolean(process.env.DATABASE_URL) && haveFfmpeg
const dataDir = mkdtempSync(path.join(tmpdir(), "badcam-it-data-"))
const mediaDir = mkdtempSync(path.join(tmpdir(), "badcam-it-media-"))
if (enabled) process.env.DATA_DIR = dataDir

const KEY = "2026-11-20_18-22-10"
const MINUTE = "2026-11-20_18-21-10"
const BASE = `SentryClips/${KEY}`
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex")

function makeClip(name: string, color: string): Buffer {
  const file = path.join(mediaDir, name)
  execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=1280x960:r=36:d=2`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      file,
    ],
    { stdio: "ignore" },
  )
  return readFileSync(file)
}

describe.skipIf(!enabled)("upload, stitch and delete", () => {
  let token = ""
  let deviceId = ""
  let db: typeof import("./db").db
  let putRoute: typeof import("../app/api/v1/files/[...path]/route").PUT
  let checkRoute: typeof import("../app/api/v1/files/check/route").POST
  let completeRoute: typeof import("../app/api/v1/events/complete/route").POST
  let pingRoute: typeof import("../app/api/v1/ping/route").POST

  const auth = () => ({ Authorization: `Bearer ${token}` })
  const put = (
    rel: string,
    body: Buffer,
    start: number,
    end: number,
    total: number,
    hash?: string,
  ) =>
    putRoute(
      new Request(`http://localhost/api/v1/files/${rel}`, {
        method: "PUT",
        body: new Uint8Array(body.subarray(start, end + 1)),
        headers: {
          ...auth(),
          "Content-Range": `bytes ${start}-${end}/${total}`,
          ...(hash ? { "X-Badcam-Sha256": hash } : {}),
        },
      }),
      { params: Promise.resolve({ path: rel.split("/") }) },
    )
  const putAll = (rel: string, body: Buffer) =>
    put(rel, body, 0, body.length - 1, body.length, sha(body))
  const post = (route: typeof checkRoute, json: unknown, headers = auth()) =>
    route(
      new Request("http://localhost/x", {
        method: "POST",
        body: JSON.stringify(json),
        headers,
      }),
    )
  const check = async (rel: string, size: number) =>
    (
      (await (
        await post(checkRoute, { files: [{ path: rel, size }] })
      ).json()) as { files: Record<string, unknown>[] }
    ).files[0]

  beforeAll(async () => {
    ;({ db } = await import("./db"))
    const { createDevice } = await import("./auth/device")
    ;({ PUT: putRoute } = await import("../app/api/v1/files/[...path]/route"))
    ;({ POST: checkRoute } = await import("../app/api/v1/files/check/route"))
    ;({ POST: completeRoute } =
      await import("../app/api/v1/events/complete/route"))
    ;({ POST: pingRoute } = await import("../app/api/v1/ping/route"))
    const created = await createDevice(`it-${Date.now()}`)
    token = created.token
    deviceId = created.device.id
  })

  afterAll(async () => {
    if (!db) return
    await db.event.deleteMany({ where: { deviceId } })
    await db.device.delete({ where: { id: deviceId } })
    await db.$disconnect()
  })

  it("refuses requests without a valid token", async () => {
    expect((await post(pingRoute, {}, {} as never)).status).toBe(401)
    expect(
      (await post(pingRoute, {}, { Authorization: "Bearer bc_nope" })).status,
    ).toBe(401)
    const ping = await post(pingRoute, { state: "RECORDING" })
    expect(ping.status).toBe(200)
    expect(await ping.json()).toMatchObject({
      ok: true,
      accepting: true,
      max_chunk_bytes: 16777216,
    })
  })

  it("rejects bad paths and ranges", async () => {
    const body = Buffer.from("x".repeat(10))
    expect(
      (await put(`SentryClips/${KEY}/..`, body, 0, 9, 10, sha(body))).status,
    ).toBe(400)
    expect(
      (
        await putRoute(
          new Request("http://localhost/x", {
            method: "PUT",
            body: "abc",
            headers: auth(),
          }),
          { params: Promise.resolve({ path: [BASE, "event.json"] }) },
        )
      ).status,
    ).toBe(400)
  })

  it("uploads in chunks, resumes after a 409, and reports complete", async () => {
    const clip = makeClip("front.mp4", "red")
    const rel = `${BASE}/${MINUTE}-front.mp4`
    const total = clip.length
    expect(total).toBeGreaterThan(3000)
    const step = Math.floor(total / 4)

    expect(await check(rel, total)).toMatchObject({
      state: "missing",
      offset: 0,
    })
    const first = await put(rel, clip, 0, step - 1, total)
    expect(first.status).toBe(202)
    expect(await first.json()).toEqual({ state: "partial", offset: step })
    expect(await check(rel, total)).toMatchObject({
      state: "partial",
      offset: step,
    })

    const skipped = await put(rel, clip, step * 2, step * 3 - 1, total)
    expect(skipped.status).toBe(409)
    expect(await skipped.json()).toEqual({
      error: "offset_mismatch",
      offset: step,
    })

    const last = await put(rel, clip, step, total - 1, total, sha(clip))
    expect(last.status).toBe(201)
    expect(await last.json()).toMatchObject({
      state: "complete",
      sha256: sha(clip),
      valid: true,
    })
    expect(await check(rel, total)).toMatchObject({
      state: "complete",
      size: total,
      sha256: sha(clip),
    })

    const again = await putAll(rel, clip)
    expect(again.status).toBe(200)
  })

  it("answers 422 for a wrong sha and discards the partial", async () => {
    const rel = `${BASE}/${MINUTE}-back.mp4`
    const clip = makeClip("back.mp4", "green")
    const res = await put(
      rel,
      clip,
      0,
      clip.length - 1,
      clip.length,
      "0".repeat(64),
    )
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: "sha_mismatch" })
    expect(await check(rel, clip.length)).toMatchObject({ state: "missing" })
    expect((await putAll(rel, clip)).status).toBe(201)
  })

  it("replaces a complete file uploaded again from offset 0 with different content", async () => {
    const rel = `${BASE}/${MINUTE}-left_repeater.mp4`
    const a = makeClip("left-a.mp4", "blue")
    expect((await putAll(rel, a)).status).toBe(201)
    const b = makeClip("left-b.mp4", "yellow")
    expect(sha(a)).not.toBe(sha(b))
    const res = await putAll(rel, b)
    expect(res.status).toBe(201)
    expect(await check(rel, b.length)).toMatchObject({
      state: "complete",
      sha256: sha(b),
    })
    const event = await db.event.findFirstOrThrow({
      where: { deviceId, key: KEY },
    })
    expect(event.stitchStatus).toBe("QUEUED")
    expect(event.uploadComplete).toBe(false)
  })

  it("stitches the event after events/complete", async () => {
    const rel = `${BASE}/${MINUTE}-right_repeater.mp4`
    expect((await putAll(rel, makeClip("right.mp4", "purple"))).status).toBe(
      201,
    )
    const json = Buffer.from(
      `{"timestamp":"2026-11-20T18:22:10","city":"Amsterdam","est_lat":"52.37","est_lon":"4.90","reason":"sentry_aware_object_detection"}`,
    )
    expect((await putAll(`${BASE}/event.json`, json)).status).toBe(201)

    const unknown = await post(completeRoute, {
      kind: "SentryClips",
      event: "2026-01-01_00-00-00",
      files: 1,
    })
    expect(unknown.status).toBe(404)

    const done = await post(completeRoute, {
      kind: "SentryClips",
      event: KEY,
      files: 6,
    })
    expect(done.status).toBe(200)
    expect(await done.json()).toEqual({ ok: true, queued: true })

    // events/complete started draining; wait for it (or drain ourselves).
    const { drain } = await import("./stitch/queue")
    for (let i = 0; i < 120; i++) {
      await drain()
      const row = await db.event.findFirstOrThrow({
        where: { deviceId, key: KEY },
      })
      if (row.stitchStatus === "DONE" || row.stitchStatus === "FAILED") break
      await new Promise((r) => setTimeout(r, 1000))
    }
    const event = await db.event.findFirstOrThrow({
      where: { deviceId, key: KEY },
    })
    expect(event.stitchError).toBeNull()
    expect(event).toMatchObject({
      stitchStatus: "DONE",
      hasPoster: true,
      city: "Amsterdam",
      reason: "sentry_aware_object_detection",
    })
    expect(event.triggerAt?.toISOString()).toBe("2026-11-20T18:22:10.000Z")
    expect(event.startedAt.toISOString()).toBe("2026-11-20T18:21:10.000Z")

    const out = path.join(dataDir, "stitched", event.id)
    expect(existsSync(path.join(out, "poster.jpg"))).toBe(true)
    const probe = execFileSync("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,width,height",
      "-of",
      "csv=p=0",
      path.join(out, "event.mp4"),
    ])
      .toString()
      .trim()
    expect(probe).toBe("h264,1280,960")
  }, 180_000)

  it("deleting leaves a tombstone, and check still says complete", async () => {
    const { deleteEvent } = await import("./retention/run")
    const event = await db.event.findFirstOrThrow({
      where: { deviceId, key: KEY },
    })
    await deleteEvent(event)
    const after = await db.event.findFirstOrThrow({
      where: { deviceId, key: KEY },
    })
    expect(after.deletedAt).not.toBeNull()
    expect(existsSync(path.join(dataDir, "stitched", event.id))).toBe(false)
    expect(existsSync(path.join(dataDir, "originals", deviceId, BASE))).toBe(
      false,
    )

    const rel = `${BASE}/${MINUTE}-front.mp4`
    expect(await check(rel, 123)).toMatchObject({ state: "complete" })
    expect(await check(`${BASE}/${MINUTE}-left_pillar.mp4`, 5)).toMatchObject({
      state: "complete",
    })
    const res = await put(
      rel,
      Buffer.from("zzz"),
      0,
      2,
      3,
      sha(Buffer.from("zzz")),
    )
    expect(res.status).toBe(200)
  })
})
