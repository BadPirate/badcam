import { parseCarTime } from "./paths"

export type EventJson = {
  timestamp: Date | null
  city: string | null
  lat: number | null
  lon: number | null
  reason: string | null
  camera: string | null
}

const EMPTY: EventJson = {
  timestamp: null,
  city: null,
  lat: null,
  lon: null,
  reason: null,
  camera: null,
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null
  const s = String(value).trim()
  return s === "" ? null : s.slice(0, max)
}

function num(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null
  if (typeof value === "string" && value.trim() === "") return null
  const n = Number(value)
  return Number.isFinite(n) && n >= min && n <= max ? n : null
}

/** Reads a Tesla event.json leniently: every field optional, bad values ignored. */
export function parseEventJson(raw: string): EventJson {
  let data: unknown
  try {
    data = JSON.parse(raw.replace(/^﻿/, ""))
  } catch {
    return { ...EMPTY }
  }
  if (typeof data !== "object" || data === null || Array.isArray(data))
    return { ...EMPTY }
  const o = data as Record<string, unknown>
  const ts = text(o.timestamp, 40)
  return {
    timestamp: ts ? parseCarTime(ts) : null,
    city: text(o.city, 120),
    lat: num(o.est_lat, -90, 90),
    lon: num(o.est_lon, -180, 180),
    reason: text(o.reason, 120),
    camera: text(o.camera, 32),
  }
}
