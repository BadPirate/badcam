const pad = (n: number) => String(n).padStart(2, "0")

/** Car-local times are stored as UTC and always shown in UTC. */
export function formatCarTime(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

export const formatCarDay = (d: Date) => formatCarTime(d).slice(0, 10)
export const formatCarClock = (d: Date) => formatCarTime(d).slice(11, 16)

export function formatDuration(sec: number | null): string {
  if (sec === null) return ""
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${pad(s)}`
}

export const prettyReason = (reason: string | null) =>
  reason?.replaceAll("_", " ") ?? null
