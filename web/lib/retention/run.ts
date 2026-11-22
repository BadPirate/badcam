import { readdir, rm, rmdir, stat, unlink } from "node:fs/promises"
import path from "node:path"

import { db } from "../db"
import { getEnv } from "../env"
import type { Event } from "../generated/prisma/client"
import { diskUsage, GIB } from "../storage/disk"
import {
  incomingDir,
  originalPath,
  originalsRoot,
  stitchedDir,
} from "../storage/layout"
import { getSettings } from "../settings"
import {
  retentionAction,
  type RetentionAction,
  type RetentionConfig,
} from "./policy"

export async function retentionConfig(): Promise<RetentionConfig> {
  const s = await getSettings()
  return {
    sentryDays: s.retainSentryDays,
    savedDays: s.retainSavedDays,
    recentDays: s.retainRecentDays,
    originalsDays: s.retainOriginalsDays,
  }
}

async function removeEmptyParents(file: string, stopAt: string): Promise<void> {
  let dir = path.dirname(file)
  while (dir.startsWith(stopAt) && dir !== stopAt) {
    try {
      await rmdir(dir)
    } catch {
      return
    }
    dir = path.dirname(dir)
  }
}

/** Deletes the original files of an event; rows stay so the Pi never re-uploads. */
export async function deleteOriginals(
  event: Pick<Event, "id" | "deviceId">,
): Promise<void> {
  const clips = await db.clip.findMany({
    where: { eventId: event.id, fileDeleted: false },
  })
  for (const clip of clips) {
    const file = originalPath(event.deviceId, clip.path)
    await unlink(file).catch(() => undefined)
    await removeEmptyParents(file, originalsRoot())
  }
  await db.clip.updateMany({
    where: { eventId: event.id },
    data: { fileDeleted: true },
  })
  await db.event.update({
    where: { id: event.id },
    data: { originalsDeletedAt: new Date() },
  })
}

/** Deletes every file of an event and leaves a tombstone row. */
export async function deleteEvent(
  event: Pick<Event, "id" | "deviceId">,
): Promise<void> {
  await deleteOriginals(event)
  await rm(stitchedDir(event.id), { recursive: true, force: true })
  await db.segment.deleteMany({ where: { eventId: event.id } })
  await db.event.update({
    where: { id: event.id },
    data: {
      deletedAt: new Date(),
      hasPoster: false,
      hasHighlight: false,
      stitchedBytes: BigInt(0),
    },
  })
}

const DAY_MS = 86_400_000

/** What the policy would do to each live event right now (no changes made). */
export async function evaluateRetention(
  now: Date = new Date(),
): Promise<{ event: Event; action: RetentionAction }[]> {
  const cfg = await retentionConfig()
  const events = await db.event.findMany({
    where: { deletedAt: null },
    orderBy: { startedAt: "asc" },
  })
  return events.map((event) => ({
    event,
    action: retentionAction(
      {
        kind: event.kind,
        startedAt: event.startedAt,
        starred: event.starred,
        stitchStatus: event.stitchStatus,
        stitchedAt:
          event.stitchStatus === "DONE"
            ? (event.stitchedAt ?? event.lastUploadAt)
            : null,
        originalsDeleted: event.originalsDeletedAt !== null,
        deleted: event.deletedAt !== null,
      },
      cfg,
      now,
    ),
  }))
}

export type RetentionPreview = {
  deleteEvents: number
  deleteOriginals: number
  /** Oldest first. */
  next: { id: string; kind: string; startedAt: Date; action: RetentionAction }[]
}

export async function retentionPreview(
  now: Date = new Date(),
): Promise<RetentionPreview> {
  const due = (await evaluateRetention(now)).filter((r) => r.action !== "keep")
  return {
    deleteEvents: due.filter((r) => r.action === "delete-event").length,
    deleteOriginals: due.filter((r) => r.action === "delete-originals").length,
    next: due.slice(0, 5).map((r) => ({
      id: r.event.id,
      kind: r.event.kind,
      startedAt: r.event.startedAt,
      action: r.action,
    })),
  }
}

export async function runRetention(now: Date = new Date()): Promise<string> {
  let deletedEvents = 0
  let deletedOriginals = 0
  for (const { event, action } of await evaluateRetention(now)) {
    if (action === "delete-event") {
      await deleteEvent(event)
      deletedEvents++
    } else if (action === "delete-originals") {
      await deleteOriginals(event)
      deletedOriginals++
    }
  }

  // Housekeeping: old partials, old job rows, old tombstones.
  let parts = 0
  const incoming = path.join(getEnv().dataDir, "incoming")
  for (const device of await readdir(incoming).catch(() => [])) {
    for (const name of await readdir(incomingDir(device)).catch(() => [])) {
      const file = path.join(incomingDir(device), name)
      const s = await stat(file).catch(() => null)
      if (
        s &&
        name.endsWith(".part") &&
        now.getTime() - s.mtime.getTime() > 7 * DAY_MS
      ) {
        await unlink(file).catch(() => undefined)
        parts++
      }
    }
  }
  await db.jobRun.deleteMany({
    where: { startedAt: { lt: new Date(now.getTime() - 14 * DAY_MS) } },
  })
  const tombstones = await db.event.deleteMany({
    where: { deletedAt: { lt: new Date(now.getTime() - 60 * DAY_MS) } },
  })

  return `events deleted ${deletedEvents}, originals deleted ${deletedOriginals}, partials ${parts}, tombstones ${tombstones.count}`
}

/** While free space is under the floor, free some: originals first, then whole events. */
export async function runDiskGuard(): Promise<string> {
  const floor = (await getSettings()).minFreeGb * GIB
  if (floor <= 0) return "disabled"
  let originals = 0
  let wholeEvents = 0
  for (let i = 0; i < 500; i++) {
    if ((await diskUsage()).freeBytes >= floor) break
    const withOriginals = await db.event.findFirst({
      where: {
        deletedAt: null,
        starred: false,
        stitchStatus: "DONE",
        originalsDeletedAt: null,
      },
      orderBy: { startedAt: "asc" },
    })
    if (withOriginals) {
      await deleteOriginals(withOriginals)
      originals++
      continue
    }
    const oldest = await db.event.findFirst({
      where: { deletedAt: null, starred: false },
      orderBy: { startedAt: "asc" },
    })
    if (!oldest) break
    await deleteEvent(oldest)
    wholeEvents++
  }
  return `originals deleted ${originals}, events deleted ${wholeEvents}`
}
