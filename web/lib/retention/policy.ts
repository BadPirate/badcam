import type { ClipKind } from "../tesla/paths"

export type RetentionConfig = {
  sentryDays: number
  savedDays: number
  recentDays: number
  originalsDays: number
}

export type RetentionEvent = {
  kind: ClipKind
  startedAt: Date
  starred: boolean
  stitchStatus: "PENDING" | "QUEUED" | "RUNNING" | "DONE" | "FAILED"
  /** When the stitch finished (the stitched file's time); null when unknown. */
  stitchedAt: Date | null
  originalsDeleted: boolean
  deleted: boolean
}

export type RetentionAction = "keep" | "delete-originals" | "delete-event"

const DAY_MS = 86_400_000

/**
 * What to do with one event. Age is measured from `startedAt`; starred and
 * already-deleted events are left alone; a value of 0 disables a rule.
 * Originals go `originalsDays` after a successful stitch only.
 */
export function retentionAction(
  e: RetentionEvent,
  cfg: RetentionConfig,
  now: Date,
): RetentionAction {
  if (e.deleted || e.starred) return "keep"
  const days = {
    SENTRY: cfg.sentryDays,
    SAVED: cfg.savedDays,
    RECENT: cfg.recentDays,
  }[e.kind]
  if (days > 0 && now.getTime() - e.startedAt.getTime() > days * DAY_MS)
    return "delete-event"
  if (
    cfg.originalsDays > 0 &&
    e.stitchStatus === "DONE" &&
    !e.originalsDeleted &&
    e.stitchedAt &&
    now.getTime() - e.stitchedAt.getTime() > cfg.originalsDays * DAY_MS
  ) {
    return "delete-originals"
  }
  return "keep"
}
