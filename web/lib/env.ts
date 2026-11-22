import path from "node:path"

export type Mirror = "none" | "back" | "rear_all"

export type Env = {
  databaseUrl: string
  ownerPassword: string
  sessionSecret: string
  dataDir: string
  retainSentryDays: number
  retainSavedDays: number
  retainRecentDays: number
  retainOriginalsDays: number
  minFreeGb: number
  stitchFps: number
  stitchCrf: number
  stitchMirror: Mirror
  highlight: boolean
  fontFile: string
}

function int(value: string | undefined, fallback: number, min = 0): number {
  if (value === undefined || value.trim() === "") return fallback
  const n = Number(value)
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback
}

export function mirrorFrom(value: string | undefined): Mirror {
  return value === "back" || value === "rear_all" ? value : "none"
}

/** Reads the environment each call, so tests can change it. */
export function getEnv(
  source: Record<string, string | undefined> = process.env,
): Env {
  return {
    databaseUrl: source.DATABASE_URL ?? "",
    ownerPassword: source.OWNER_PASSWORD ?? "",
    sessionSecret: source.SESSION_SECRET ?? "",
    dataDir: path.resolve(/*turbopackIgnore: true*/ source.DATA_DIR || "/data"),
    retainSentryDays: int(source.RETAIN_SENTRY_DAYS, 90),
    retainSavedDays: int(source.RETAIN_SAVED_DAYS, 0),
    retainRecentDays: int(source.RETAIN_RECENT_DAYS, 7),
    retainOriginalsDays: int(source.RETAIN_ORIGINALS_DAYS, 14),
    minFreeGb: int(source.MIN_FREE_GB, 5),
    stitchFps: int(source.STITCH_FPS, 24, 1),
    stitchCrf: int(source.STITCH_CRF, 26),
    stitchMirror: mirrorFrom(source.STITCH_MIRROR),
    highlight: source.HIGHLIGHT === "true",
    fontFile:
      source.FONT_FILE || "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  }
}
