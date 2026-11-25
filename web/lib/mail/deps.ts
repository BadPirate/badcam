import { db } from "../db"
import { diskUsage } from "../storage/disk"
import type { NotifyDeps, NotifyStore } from "./notify"
import { deliver, safeError } from "./send"
import { loadMailContext, patchStoredMail } from "./store"

const SENT_KINDS = ["SENTRY", "SAVED"] as const

const prismaStore: NotifyStore = {
  async getEvent(id) {
    const e = await db.event.findUnique({
      where: { id },
      include: { device: { select: { name: true } } },
    })
    return e ? { ...e, deviceName: e.device.name } : null
  },
  async claimEvent(id, now) {
    const r = await db.event.updateMany({
      where: { id, notifiedAt: null },
      data: { notifiedAt: now },
    })
    return r.count === 1
  },
  async releaseEvent(id) {
    await db.event.update({ where: { id }, data: { notifiedAt: null } })
  },
  async unsentEventIds(stitchedAfter) {
    const rows = await db.event.findMany({
      where: {
        stitchStatus: "DONE",
        notifiedAt: null,
        deletedAt: null,
        kind: { in: [...SENT_KINDS] },
        stitchedAt: { gte: stitchedAfter },
      },
      select: { id: true },
      orderBy: { stitchedAt: "asc" },
      take: 50,
    })
    return rows.map((r) => r.id)
  },
  async eventsCreatedBetween(since, until) {
    const rows = await db.event.findMany({
      where: {
        deletedAt: null,
        kind: { in: [...SENT_KINDS] },
        createdAt: { gt: since, lte: until },
      },
      include: { device: { select: { name: true } } },
      orderBy: { startedAt: "asc" },
      take: 500,
    })
    return rows.map((e) => ({ ...e, deviceName: e.device.name }))
  },
  devices: () => db.device.findMany({ orderBy: { createdAt: "asc" } }),
  async patchDevice(id, patch) {
    await db.device.update({ where: { id }, data: patch })
  },
  async saveLastSummary(at) {
    await patchStoredMail({ lastSummaryAt: at })
  },
}

export const notifyDeps: NotifyDeps = {
  store: prismaStore,
  context: loadMailContext,
  // Errors leave here with the credentials already scrubbed, so logs are safe.
  async send(ctx, message) {
    try {
      return await deliver(ctx, message)
    } catch (error) {
      throw new Error(safeError(error, ctx))
    }
  },
  disk: () => diskUsage().catch(() => null),
  now: () => new Date(),
  log: (message) => console.error(`[mail] ${message}`),
}
