export const SUMMARY_TIMEZONE = "Europe/Amsterdam"

/** The date (YYYY-MM-DD) and clock (HH:MM) of an instant in a time zone. */
export function zonedParts(
  at: Date,
  timeZone: string = SUMMARY_TIMEZONE,
): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00"
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  }
}

export const isClock = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
