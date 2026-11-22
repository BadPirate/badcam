import { mkdir, rename, rm, stat, writeFile, readdir } from "node:fs/promises"
import path from "node:path"

import { db } from "../db"
import { getEnv } from "../env"
import type { Clip, Event } from "../generated/prisma/client"
import { originalPath, stitchedDir, tmpDir } from "../storage/layout"
import { KNOWN_CAMERAS, eventKeyTime, type KnownCamera } from "../tesla/paths"
import {
  buildSegmentArgs,
  concatArgs,
  highlightArgs,
  posterFromThumbArgs,
  posterFromVideoArgs,
  probeVideo,
  runFfmpeg,
} from "./ffmpeg"

const DRAINING = Symbol.for("badcam.stitch-draining")

function setDraining(value: boolean) {
  ;(globalThis as unknown as Record<symbol, boolean>)[DRAINING] = value
}
export const isDraining = () =>
  (globalThis as unknown as Record<symbol, boolean | undefined>)[DRAINING] ===
  true

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}

/** Stitches queued events one at a time. A second caller returns at once. */
export async function drain(): Promise<number> {
  if (isDraining()) return 0
  setDraining(true)
  let done = 0
  try {
    for (;;) {
      const event = await db.event.findFirst({
        where: {
          stitchStatus: "QUEUED",
          uploadComplete: true,
          deletedAt: null,
        },
        orderBy: { startedAt: "asc" },
      })
      if (!event) break
      const claimed = await db.event.updateMany({
        where: { id: event.id, stitchStatus: "QUEUED" },
        data: { stitchStatus: "RUNNING", stitchError: null },
      })
      if (claimed.count === 0) continue
      try {
        await stitchEvent(event)
        done++
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await db.event.updateMany({
          where: { id: event.id, stitchStatus: "RUNNING" },
          data: { stitchStatus: "FAILED", stitchError: message.slice(-2000) },
        })
        console.error(
          `[stitch] event ${event.id} failed: ${message.slice(0, 300)}`,
        )
      }
    }
  } finally {
    setDraining(false)
  }
  return done
}

type ClipRow = Pick<
  Clip,
  "path" | "camera" | "minuteKey" | "valid" | "fileDeleted" | "durationSec"
>

function groupByMinute(
  clips: ClipRow[],
): Map<string, Partial<Record<KnownCamera, ClipRow>>> {
  const minutes = new Map<string, Partial<Record<KnownCamera, ClipRow>>>()
  for (const clip of clips) {
    if (!clip.valid || clip.fileDeleted || !clip.minuteKey || !clip.camera)
      continue
    if (!(KNOWN_CAMERAS as readonly string[]).includes(clip.camera)) continue
    const entry = minutes.get(clip.minuteKey) ?? {}
    entry[clip.camera as KnownCamera] = clip
    minutes.set(clip.minuteKey, entry)
  }
  return new Map([...minutes].sort(([a], [b]) => a.localeCompare(b)))
}

async function stitchEvent(event: Event): Promise<void> {
  const env = getEnv()
  const clips = await db.clip.findMany({ where: { eventId: event.id } })
  const minutes = groupByMinute(clips)
  if (minutes.size === 0) throw new Error("no video")

  const outDir = stitchedDir(event.id)
  await mkdir(outDir, { recursive: true })
  await mkdir(tmpDir(), { recursive: true })
  const work = path.join(tmpDir(), `${event.id}-${Date.now()}`)
  await mkdir(work, { recursive: true })

  try {
    const segmentFiles: string[] = []
    for (const [minuteKey, cams] of minutes) {
      const final = path.join(outDir, `seg-${minuteKey}.mp4`)
      const existing = await db.segment.findUnique({
        where: { eventId_minuteKey: { eventId: event.id, minuteKey } },
      })
      if (existing?.status === "DONE" && (await exists(final))) {
        segmentFiles.push(final)
        continue
      }

      const epoch = Math.floor((eventKeyTime(minuteKey)?.getTime() ?? 0) / 1000)
      const inputs: Partial<Record<KnownCamera, string | null>> = {}
      let maxDuration = 0
      for (const cam of KNOWN_CAMERAS) {
        const clip = cams[cam]
        if (clip && (await exists(originalPath(event.deviceId, clip.path)))) {
          inputs[cam] = originalPath(event.deviceId, clip.path)
          maxDuration = Math.max(maxDuration, clip.durationSec ?? 0)
        } else {
          inputs[cam] = null
        }
      }
      if (!Object.values(inputs).some(Boolean)) continue
      if (maxDuration <= 0) maxDuration = 60

      await db.segment.upsert({
        where: { eventId_minuteKey: { eventId: event.id, minuteKey } },
        create: { eventId: event.id, minuteKey, status: "RUNNING" },
        update: { status: "RUNNING", error: null },
      })
      const tmp = path.join(work, `seg-${minuteKey}.mp4`)
      const result = await runFfmpeg(
        buildSegmentArgs({
          inputs,
          epoch,
          maxDuration,
          fontFile: env.fontFile,
          fps: env.stitchFps,
          crf: env.stitchCrf,
          mirror: env.stitchMirror,
          output: tmp,
        }),
      )
      if (!result.ok) {
        await db.segment.update({
          where: { eventId_minuteKey: { eventId: event.id, minuteKey } },
          data: { status: "FAILED", error: result.error },
        })
        throw new Error(`segment ${minuteKey}: ${result.error}`)
      }
      await rename(tmp, final)
      const probe = await probeVideo(final)
      await db.segment.update({
        where: { eventId_minuteKey: { eventId: event.id, minuteKey } },
        data: { status: "DONE", durationSec: probe.durationSec },
      })
      segmentFiles.push(final)
    }
    if (segmentFiles.length === 0) throw new Error("no video")

    const list = path.join(work, "list.txt")
    await writeFile(
      list,
      segmentFiles
        .map((f) => `file '${f.replaceAll("'", "'\\''")}'`)
        .join("\n") + "\n",
    )
    const eventTmp = path.join(work, "event.mp4")
    const concat = await runFfmpeg(concatArgs(list, eventTmp))
    if (!concat.ok) throw new Error(`concat: ${concat.error}`)

    const probe = await probeVideo(eventTmp)
    if (!probe.valid) throw new Error("concat produced an unplayable file")

    // Poster: the uploaded thumb, else a frame near the trigger.
    const posterTmp = path.join(work, "poster.jpg")
    let hasPoster = false
    const thumb = clips.find(
      (c) => c.path.endsWith("/thumb.png") && !c.fileDeleted,
    )
    if (thumb && (await exists(originalPath(event.deviceId, thumb.path)))) {
      hasPoster = (
        await runFfmpeg(
          posterFromThumbArgs(
            originalPath(event.deviceId, thumb.path),
            posterTmp,
          ),
        )
      ).ok
    }
    if (!hasPoster) {
      const duration = probe.durationSec ?? 2
      const offset =
        event.triggerAt && event.startedAt
          ? (event.triggerAt.getTime() - event.startedAt.getTime()) / 1000
          : 1
      const t = Math.max(0, Math.min(offset, duration - 0.5))
      hasPoster = (await runFfmpeg(posterFromVideoArgs(eventTmp, t, posterTmp)))
        .ok
    }

    let hasHighlight = false
    const highlightTmp = path.join(work, "highlight.mp4")
    if (env.highlight) {
      const r = await runFfmpeg(highlightArgs(eventTmp, highlightTmp))
      if (r.ok) hasHighlight = (await probeVideo(highlightTmp)).valid
    }

    await rename(eventTmp, path.join(outDir, "event.mp4"))
    if (hasPoster) await rename(posterTmp, path.join(outDir, "poster.jpg"))
    if (hasHighlight)
      await rename(highlightTmp, path.join(outDir, "highlight.mp4"))
    else await rm(path.join(outDir, "highlight.mp4"), { force: true })

    for (const name of await readdir(outDir)) {
      if (name.startsWith("seg-"))
        await rm(path.join(outDir, name), { force: true })
    }
    await db.segment.deleteMany({ where: { eventId: event.id } })

    const size = (await stat(path.join(outDir, "event.mp4"))).size
    await db.event.updateMany({
      where: { id: event.id, stitchStatus: "RUNNING" },
      data: {
        stitchStatus: "DONE",
        stitchError: null,
        stitchedBytes: BigInt(size),
        durationSec: probe.durationSec ? Math.round(probe.durationSec) : null,
        hasPoster,
        hasHighlight,
      },
    })
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

/** Throws the stitched output away so the next stitch starts clean. */
export async function resetStitched(eventId: string): Promise<void> {
  await rm(stitchedDir(eventId), { recursive: true, force: true })
  await db.segment.deleteMany({ where: { eventId } })
}
