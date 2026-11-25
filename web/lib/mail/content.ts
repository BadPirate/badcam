// Pure builders for the messages badcam sends. Times are the car's own clock,
// as everywhere else in the app (stored as UTC, shown as written).
import type { EmailContent } from "@kaperkunde/mail/template"

import { formatCarTime, formatDuration, prettyReason } from "../format"
import { SUMMARY_TIMEZONE, zonedParts } from "./time"

export type Message = EmailContent & { subject: string }

export type EventMailData = {
  id: string
  kind: "SENTRY" | "SAVED" | "RECENT"
  startedAt: Date
  triggerAt: Date | null
  city: string | null
  lat: number | null
  lon: number | null
  reason: string | null
  camera: string | null
  durationSec: number | null
  deviceName: string
}

const KIND_LABEL = {
  SENTRY: "Sentry event",
  SAVED: "Saved clip",
  RECENT: "Clip",
}
const strong = (label: string, value: string) => [
  { strong: label },
  ` ${value}`,
]

export const eventUrl = (publicUrl: string, id: string) =>
  publicUrl ? `${publicUrl}/events/${id}` : undefined

export function eventMessage(e: EventMailData, publicUrl: string): Message {
  const label = KIND_LABEL[e.kind]
  const when = formatCarTime(e.triggerAt ?? e.startedAt).slice(0, 16)
  const place = e.city ?? "unknown place"
  const url = eventUrl(publicUrl, e.id)
  const lines: EmailContent["paragraphs"][number][] = [
    strong("When:", `${when} (car clock)`),
    strong("Where:", place),
  ]
  const reason = prettyReason(e.reason)
  if (reason) lines.push(strong("Reason:", reason))
  if (e.camera) lines.push(strong("Camera:", e.camera))
  if (e.durationSec !== null)
    lines.push(strong("Duration:", formatDuration(e.durationSec)))
  lines.push(strong("Device:", e.deviceName))
  const map =
    e.lat !== null && e.lon !== null
      ? {
          text: "Show on map",
          url: `https://www.openstreetmap.org/?mlat=${e.lat}&mlon=${e.lon}#map=16/${e.lat}/${e.lon}`,
        }
      : undefined
  return {
    subject: `Badcam: ${label} ready (${place}, ${when})`,
    heading: `${label} ready`,
    paragraphs: lines,
    ...(url ? { cta: { text: "Open the event", url } } : {}),
    ...(map ? { secondaryLink: map } : {}),
    reason: `You get this because "${label} ready" mails are turned on in the badcam settings.`,
    preheader: `${place}, ${when}${reason ? `: ${reason}` : ""}`,
  }
}

export type DeviceLine = {
  name: string
  lastSeenAt: Date | null
  state?: string
  batteryV?: number
  freeBytes?: number
}

export type SummaryInput = {
  since: Date
  until: Date
  events: (EventMailData & { stitchStatus?: string })[]
  disk: { usedBytes: number; totalBytes: number; freeBytes: number } | null
  devices: DeviceLine[]
  publicUrl: string
}

const MAX_LINKS = 25

export function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"]
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

export function summaryMessage(s: SummaryInput): Message {
  const sentry = s.events.filter((e) => e.kind === "SENTRY")
  const saved = s.events.filter((e) => e.kind === "SAVED")
  const day = zonedParts(s.until, SUMMARY_TIMEZONE).date
  const paragraphs: EmailContent["paragraphs"][number][] = [
    `Since ${zonedParts(s.since).date} ${zonedParts(s.since).time} (${SUMMARY_TIMEZONE}): ${sentry.length} Sentry ${sentry.length === 1 ? "event" : "events"}, ${saved.length} saved ${saved.length === 1 ? "clip" : "clips"}.`,
  ]
  if (s.disk)
    paragraphs.push(
      strong(
        "Storage:",
        `${formatBytes(s.disk.usedBytes)} used of ${formatBytes(s.disk.totalBytes)}, ${formatBytes(s.disk.freeBytes)} free.`,
      ),
    )
  for (const d of s.devices) {
    const bits = [
      d.lastSeenAt
        ? `last seen ${formatCarTime(d.lastSeenAt)} UTC`
        : "never seen",
    ]
    if (d.state) bits.push(d.state)
    if (typeof d.batteryV === "number") bits.push(`battery ${d.batteryV} V`)
    if (typeof d.freeBytes === "number")
      bits.push(`card ${formatBytes(d.freeBytes)} free`)
    paragraphs.push(strong(`${d.name}:`, bits.join(", ")))
  }
  const shown = s.events.slice(0, MAX_LINKS)
  const links = shown.flatMap((e) => {
    const url = eventUrl(s.publicUrl, e.id)
    if (!url) return []
    const reason = prettyReason(e.reason)
    return [
      {
        label:
          `${KIND_LABEL[e.kind]} ${formatCarTime(e.startedAt).slice(0, 16)} ${e.city ?? ""}${reason ? ` (${reason})` : ""}`.replace(
            /\s+/g,
            " ",
          ),
        url,
      },
    ]
  })
  if (s.events.length > shown.length)
    paragraphs.push(`And ${s.events.length - shown.length} more.`)
  return {
    subject: `Badcam daily summary ${day}: ${sentry.length} Sentry, ${saved.length} saved`,
    heading: "Badcam daily summary",
    paragraphs,
    ...(links.length > 0 ? { links } : {}),
    ...(s.publicUrl ? { cta: { text: "Open badcam", url: s.publicUrl } } : {}),
    reason:
      'You get this because the "daily summary" mail is turned on in the badcam settings.',
  }
}

export type AlertKind = "lowBattery" | "lowCard" | "offline"

export function alertMessage(
  device: string,
  alerts: { kind: AlertKind; text: string }[],
  publicUrl: string,
): Message {
  return {
    subject: `Badcam alert: ${device}`,
    heading: `Alert for ${device}`,
    paragraphs: alerts.map((a) => a.text),
    ...(publicUrl
      ? { cta: { text: "Open settings", url: `${publicUrl}/settings` } }
      : {}),
    footnote: "You get one mail per problem until it clears.",
    reason:
      'You get this because "device alerts" are turned on in the badcam settings.',
  }
}

export function testMessage(publicUrl: string): Message {
  return {
    subject: "Badcam test email",
    heading: "Test email",
    paragraphs: ["If you can read this, badcam can send mail."],
    ...(publicUrl ? { cta: { text: "Open badcam", url: publicUrl } } : {}),
    reason: "You asked for a test email on the badcam settings page.",
  }
}
