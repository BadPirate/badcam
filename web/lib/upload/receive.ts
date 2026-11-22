import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, rename, rm, stat, truncate, readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import path from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { isUniqueViolation } from "@kaperkunde/next-kit/prisma"

import { db } from "../db"
import { sha256Hex } from "../auth/device"
import { getEnv } from "../env"
import type { Device } from "../generated/prisma/client"
import { probeVideo } from "../stitch/ffmpeg"
import { GIB, diskUsage } from "../storage/disk"
import { incomingDir, originalPath } from "../storage/layout"
import { parseContentRange } from "../storage/range"
import { parseEventJson } from "../tesla/event-json"
import { eventKeyTime, parseSegments, type ParsedPath } from "../tesla/paths"

export const MAX_CHUNK_BYTES = 16 * 1024 * 1024
const MIN_FREE_BYTES = 1 * GIB

type Json = Record<string, unknown>
const json = (status: number, body: Json, headers?: Record<string, string>) =>
  Response.json(body, { status, headers })

// One writer per device+path at a time (in-process).
const LOCKS = Symbol.for("badcam.upload-locks")
function locks(): Set<string> {
  const holder = globalThis as unknown as Record<
    symbol,
    Set<string> | undefined
  >
  holder[LOCKS] ??= new Set()
  return holder[LOCKS]
}

export const partPath = (deviceId: string, contractPath: string) =>
  path.join(incomingDir(deviceId), `${sha256Hex(contractPath)}.part`)

async function fileSize(file: string): Promise<number | null> {
  try {
    return (await stat(file)).size
  } catch {
    return null
  }
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256")
  await pipeline(createReadStream(file), hash)
  return hash.digest("hex")
}

async function dropBody(request: Request): Promise<void> {
  try {
    await request.body?.cancel()
  } catch {
    // already closed
  }
}

export async function receiveChunk(
  request: Request,
  device: Device,
  segments: string[],
): Promise<Response> {
  const parsedResult = parseSegments(segments)
  if (!parsedResult.ok) return json(400, { error: "bad_path" })
  const parsed = parsedResult.parsed

  const range = parseContentRange(request.headers.get("content-range"))
  if (!range) return json(400, { error: "bad_range" })
  const shaHeader =
    request.headers.get("x-badcam-sha256")?.toLowerCase() ?? null
  if (shaHeader !== null && !/^[0-9a-f]{64}$/.test(shaHeader))
    return json(400, { error: "bad_range" })

  const declaredLength = Number(request.headers.get("content-length") ?? NaN)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CHUNK_BYTES) {
    await dropBody(request)
    return json(413, { error: "chunk_too_large" })
  }
  const chunkLength = range.end - range.start + 1
  if (chunkLength > MAX_CHUNK_BYTES) {
    await dropBody(request)
    return json(413, { error: "chunk_too_large" })
  }
  if (Number.isFinite(declaredLength) && declaredLength !== chunkLength) {
    await dropBody(request)
    return json(400, { error: "bad_range" })
  }

  // Files the server already has (or whose event the owner deleted) are done.
  const existing = await db.clip.findUnique({
    where: { deviceId_path: { deviceId: device.id, path: parsed.path } },
  })
  const tombstoned = await db.event.findFirst({
    where: {
      deviceId: device.id,
      kind: parsed.kind,
      key: parsed.eventKey,
      deletedAt: { not: null },
    },
    select: { id: true },
  })
  if (tombstoned) {
    await dropBody(request)
    return json(200, {
      state: "complete",
      sha256: existing?.sha256 ?? shaHeader ?? "0".repeat(64),
      valid: true,
    })
  }
  if (
    existing &&
    existing.size === range.total &&
    shaHeader &&
    existing.sha256 === shaHeader
  ) {
    await dropBody(request)
    return json(200, {
      state: "complete",
      sha256: existing.sha256,
      valid: existing.valid,
    })
  }

  const { freeBytes } = await diskUsage(getEnv().dataDir)
  if (freeBytes < MIN_FREE_BYTES) {
    await dropBody(request)
    return json(507, { error: "storage_full" })
  }

  const key = `${device.id}:${parsed.path}`
  if (locks().has(key)) {
    await dropBody(request)
    return json(503, { error: "busy" }, { "Retry-After": "2" })
  }
  locks().add(key)
  try {
    return await writeChunk(
      request,
      device,
      parsed,
      range,
      shaHeader,
      existing !== null,
    )
  } finally {
    locks().delete(key)
  }
}

async function writeChunk(
  request: Request,
  device: Device,
  parsed: ParsedPath,
  range: { start: number; end: number; total: number },
  shaHeader: string | null,
  replacing: boolean,
): Promise<Response> {
  const part = partPath(device.id, parsed.path)
  await mkdir(path.dirname(part), { recursive: true })

  const have = (await fileSize(part)) ?? 0
  if (range.start === 0) {
    // Always (re)starts the partial.
  } else if (range.start !== have) {
    await dropBody(request)
    return json(409, { error: "offset_mismatch", offset: have })
  }

  if (!request.body) return json(400, { error: "bad_range" })

  let received = 0
  const limit = range.end - range.start + 1
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length
      if (received > limit)
        return cb(new Error("body longer than Content-Range"))
      cb(null, chunk)
    },
  })

  try {
    await pipeline(
      Readable.fromWeb(
        request.body as import("node:stream/web").ReadableStream,
      ),
      counter,
      createWriteStream(part, {
        flags: range.start === 0 ? "w" : "r+",
        start: range.start,
      }),
    )
  } catch {
    await truncate(part, range.start).catch(() => undefined)
    return json(400, { error: "bad_range" })
  }

  if (received !== limit) {
    await truncate(part, range.start).catch(() => undefined)
    return json(400, { error: "bad_range" })
  }

  if (range.end + 1 < range.total) {
    return json(202, { state: "partial", offset: range.end + 1 })
  }

  // Last chunk: verify and store.
  if (!shaHeader) {
    await truncate(part, range.start).catch(() => undefined)
    return json(400, { error: "bad_range" })
  }
  const actual = await sha256File(part)
  if (actual !== shaHeader) {
    await rm(part, { force: true })
    return json(422, { error: "sha_mismatch" })
  }

  const final = originalPath(device.id, parsed.path)
  await mkdir(path.dirname(final), { recursive: true })
  await rename(part, final)

  const valid = await indexFile(
    device,
    parsed,
    final,
    range.total,
    actual,
    replacing,
  )
  return json(201, { state: "complete", sha256: actual, valid })
}

async function indexFile(
  device: Device,
  parsed: ParsedPath,
  file: string,
  size: number,
  sha256: string,
  replacing: boolean,
): Promise<boolean> {
  let valid = true
  let durationSec: number | null = null
  let width: number | null = null
  let height: number | null = null
  if (parsed.fileName.endsWith(".mp4")) {
    const probe = await probeVideo(file)
    valid = probe.valid
    durationSec = probe.durationSec
    width = probe.width
    height = probe.height
  }

  const eventJson =
    parsed.fileName === "event.json"
      ? parseEventJson(await readFile(file, "utf8").catch(() => ""))
      : null
  const rawJson = eventJson
    ? (await readFile(file, "utf8").catch(() => "")).slice(0, 8000)
    : null

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await db.$transaction(async (tx) => {
        const keyTime = eventKeyTime(parsed.eventKey) ?? new Date()
        const event = await tx.event.upsert({
          where: {
            deviceId_kind_key: {
              deviceId: device.id,
              kind: parsed.kind,
              key: parsed.eventKey,
            },
          },
          create: {
            deviceId: device.id,
            kind: parsed.kind,
            key: parsed.eventKey,
            startedAt: keyTime,
          },
          update: {},
        })

        await tx.clip.upsert({
          where: { deviceId_path: { deviceId: device.id, path: parsed.path } },
          create: {
            deviceId: device.id,
            eventId: event.id,
            path: parsed.path,
            camera: parsed.camera,
            minuteKey: parsed.minuteKey,
            size,
            sha256,
            valid,
            durationSec,
            width,
            height,
          },
          update: {
            size,
            sha256,
            valid,
            durationSec,
            width,
            height,
            uploadedAt: new Date(),
            fileDeleted: false,
          },
        })

        const clips = await tx.clip.findMany({
          where: { eventId: event.id },
          select: { minuteKey: true, size: true },
        })
        const minutes = clips
          .map((c) => c.minuteKey)
          .filter((m): m is string => m !== null)
          .sort()
        const first = minutes[0] ? eventKeyTime(minutes[0]) : null
        const last = minutes.at(-1) ? eventKeyTime(minutes.at(-1)!) : null

        const requeue =
          replacing ||
          event.stitchStatus === "DONE" ||
          event.stitchStatus === "FAILED"
        await tx.event.update({
          where: { id: event.id },
          data: {
            startedAt: first ?? keyTime,
            endedAt: last ? new Date(last.getTime() + 60_000) : null,
            lastUploadAt: new Date(),
            originalsBytes: BigInt(clips.reduce((sum, c) => sum + c.size, 0)),
            ...(requeue
              ? { stitchStatus: "QUEUED" as const, uploadComplete: false }
              : {}),
            ...(eventJson
              ? {
                  triggerAt: eventJson.timestamp,
                  city: eventJson.city,
                  lat: eventJson.lat,
                  lon: eventJson.lon,
                  reason: eventJson.reason,
                  camera: eventJson.camera,
                  rawJson,
                }
              : {}),
          },
        })
      })
      return valid
    } catch (error) {
      if (attempt === 0 && isUniqueViolation(error)) continue
      throw error
    }
  }
  return valid
}
