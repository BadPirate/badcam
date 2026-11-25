import { fail, ok, type Result } from "@kaperkunde/next-kit"

export type ClipKind = "SENTRY" | "SAVED" | "RECENT"
export type TeslaDir = "SentryClips" | "SavedClips" | "RecentClips"

export type ParsedPath = {
  /** The contract path, joined with forward slashes. */
  path: string
  dir: TeslaDir
  kind: ClipKind
  /** The event folder name; `YYYY-MM-DD_HH` for RecentClips. */
  eventKey: string
  fileName: string
  /** `YYYY-MM-DD_HH-MM-SS` of a clip, else null. */
  minuteKey: string | null
  /** Camera name of a clip, else null (event.json, thumb.png, other). */
  camera: string | null
}

const EVENT_RE =
  /^(SentryClips|SavedClips)\/(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})\/([A-Za-z0-9._-]{1,80})$/
const RECENT_RE = /^RecentClips\/([A-Za-z0-9._-]{1,80})$/
const CLIP_RE = /^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})-([a-z0-9_]+)\.mp4$/
const HOUR_RE = /^\d{4}-\d{2}-\d{2}_\d{2}/

export const KINDS: Record<TeslaDir, ClipKind> = {
  SentryClips: "SENTRY",
  SavedClips: "SAVED",
  RecentClips: "RECENT",
}

export const DIRS: Record<ClipKind, TeslaDir> = {
  SENTRY: "SentryClips",
  SAVED: "SavedClips",
  RECENT: "RecentClips",
}

const bad = () => fail("INVALID", "bad_path")

/**
 * Validates a contract path (§3). Anything outside the grammar, any dot-only
 * segment or backslash, is refused.
 */
export function parseContractPath(
  path: string,
): Result<{ parsed: ParsedPath }> {
  if (path.includes("\\") || path.includes("\0")) return bad()
  const segments = path.split("/")
  if (segments.some((s) => s === "" || s === "." || s === "..")) return bad()

  const event = EVENT_RE.exec(path)
  const recent = event ? null : RECENT_RE.exec(path)
  if (!event && !recent) return bad()

  const dir = (event ? event[1] : "RecentClips") as TeslaDir
  const fileName = (event ? event[3] : recent![1]) as string
  if (fileName.startsWith(".")) return bad()

  let eventKey: string
  if (event) {
    eventKey = event[2] as string
  } else {
    if (!HOUR_RE.test(fileName)) return bad()
    eventKey = fileName.slice(0, 13)
  }

  const clip = CLIP_RE.exec(fileName)
  return ok({
    parsed: {
      path,
      dir,
      kind: KINDS[dir],
      eventKey,
      fileName,
      minuteKey: clip ? (clip[1] as string) : null,
      camera: clip ? (clip[2] as string) : null,
    },
  })
}

/** Parses the segments of a catch-all route param (already URL-decoded). */
export function parseSegments(
  segments: string[],
): Result<{ parsed: ParsedPath }> {
  if (segments.some((s) => s.includes("/"))) return bad()
  return parseContractPath(segments.join("/"))
}

/**
 * Tesla timestamps are car-local with no zone. They are stored as if they
 * were UTC and always shown in UTC, so the site shows what the car wrote.
 */
export function parseCarTime(text: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T_](\d{2})[:-](\d{2})[:-](\d{2})$/.exec(
    text.trim(),
  )
  if (!m) return null
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s))
  return Number.isNaN(date.getTime()) || date.getUTCMonth() !== mo - 1
    ? null
    : date
}

/** `2026-11-20_18-22-10` or `2026-11-20_18` to a UTC date. */
export function eventKeyTime(key: string): Date | null {
  if (/^\d{4}-\d{2}-\d{2}_\d{2}$/.test(key)) return parseCarTime(`${key}-00-00`)
  return parseCarTime(key)
}

export const KNOWN_CAMERAS = [
  "front",
  "back",
  "left_repeater",
  "right_repeater",
] as const
export type KnownCamera = (typeof KNOWN_CAMERAS)[number]
