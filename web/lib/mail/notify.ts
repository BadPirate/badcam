// What to mail and when. Everything outside the pure rules is injected, so the
// tests run with a fake store and a fake mailer.
import { formatCarTime } from "../format"
import {
  alertMessage,
  eventMessage,
  summaryMessage,
  testMessage,
  type AlertKind,
  type DeviceLine,
  type EventMailData,
  type Message,
} from "./content"
import { zonedParts } from "./time"
import type { Delivery, MailContext } from "./send"

export const RETRY_WINDOW_MS = 24 * 3600_000
const GIB = 1024 ** 3

export type EventRow = EventMailData & {
  stitchStatus: string
  notifiedAt: Date | null
  deletedAt: Date | null
}

export type DeviceRow = {
  id: string
  name: string
  lastSeenAt: Date | null
  lastStatus: string | null
  revokedAt: Date | null
  alertLowBatteryAt: Date | null
  alertLowCardAt: Date | null
  alertOfflineAt: Date | null
}

export type DeviceAlertPatch = Partial<
  Pick<DeviceRow, "alertLowBatteryAt" | "alertLowCardAt" | "alertOfflineAt">
>

export type NotifyStore = {
  getEvent(id: string): Promise<EventRow | null>
  /** Sets notifiedAt when it is null; true when this call won. */
  claimEvent(id: string, now: Date): Promise<boolean>
  releaseEvent(id: string): Promise<void>
  unsentEventIds(stitchedAfter: Date): Promise<string[]>
  eventsCreatedBetween(since: Date, until: Date): Promise<EventMailData[]>
  devices(): Promise<DeviceRow[]>
  patchDevice(id: string, patch: DeviceAlertPatch): Promise<void>
  saveLastSummary(at: Date): Promise<void>
}

export type NotifyDeps = {
  store: NotifyStore
  context(): Promise<MailContext>
  send(ctx: MailContext, message: Message): Promise<Delivery>
  disk(): Promise<{
    usedBytes: number
    totalBytes: number
    freeBytes: number
  } | null>
  now(): Date
  log(message: string): void
}

const describe = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

export type EventOutcome = "sent" | "skipped" | "failed" | "already"

/** Mails "ready" for one event, once. Never throws. */
export async function notifyEventReady(
  eventId: string,
  deps: NotifyDeps,
): Promise<EventOutcome> {
  try {
    const event = await deps.store.getEvent(eventId)
    if (!event) return "skipped"
    if (event.notifiedAt) return "already"
    if (event.stitchStatus !== "DONE" || event.deletedAt) return "skipped"
    if (event.kind === "RECENT") return "skipped"
    const ctx = await deps.context()
    const wanted =
      event.kind === "SENTRY" ? ctx.prefs.notifySentry : ctx.prefs.notifySaved
    if (!wanted || ctx.mode === "not-configured" || ctx.recipients.length === 0)
      return "skipped"
    if (!(await deps.store.claimEvent(eventId, deps.now()))) return "already"
    try {
      const result = await deps.send(ctx, eventMessage(event, ctx.publicUrl))
      if (result === "sent") return "sent"
      await deps.store.releaseEvent(eventId)
      return "skipped"
    } catch (error) {
      await deps.store.releaseEvent(eventId)
      deps.log(`event mail ${eventId} failed: ${describe(error)}`)
      return "failed"
    }
  } catch (error) {
    deps.log(`event mail ${eventId} failed: ${describe(error)}`)
    return "failed"
  }
}

/** Tries events whose mail failed earlier, for up to 24 hours after the stitch. */
export async function retryUnsent(deps: NotifyDeps): Promise<number> {
  const ids = await deps.store.unsentEventIds(
    new Date(deps.now().getTime() - RETRY_WINDOW_MS),
  )
  let sent = 0
  for (const id of ids)
    if ((await notifyEventReady(id, deps)) === "sent") sent++
  return sent
}

function parseStatus(text: string | null): {
  battery_v?: number
  free_bytes?: number
  state?: string
} {
  try {
    const v: unknown = text ? JSON.parse(text) : {}
    return v && typeof v === "object" ? (v as Record<string, never>) : {}
  } catch {
    return {}
  }
}

export function deviceLines(devices: DeviceRow[]): DeviceLine[] {
  return devices
    .filter((d) => !d.revokedAt)
    .map((d) => {
      const s = parseStatus(d.lastStatus)
      return {
        name: d.name,
        lastSeenAt: d.lastSeenAt,
        state: typeof s.state === "string" ? s.state : undefined,
        batteryV: typeof s.battery_v === "number" ? s.battery_v : undefined,
        freeBytes: typeof s.free_bytes === "number" ? s.free_bytes : undefined,
      }
    })
}

export type SummaryOutcome =
  "off" | "not-yet" | "already" | "skipped" | "nothing" | "sent" | "failed"

/** The daily summary: once a day, from the configured time (Europe/Amsterdam). */
export async function runDailySummary(
  deps: NotifyDeps,
): Promise<SummaryOutcome> {
  const ctx = await deps.context()
  const p = ctx.prefs
  if (!p.notifyDaily) return "off"
  if (ctx.mode === "not-configured" || ctx.recipients.length === 0)
    return "skipped"
  const now = deps.now()
  const local = zonedParts(now)
  if (local.time < p.dailyTime) return "not-yet"
  if (p.lastSummaryAt && zonedParts(p.lastSummaryAt).date === local.date)
    return "already"
  const since = p.lastSummaryAt ?? new Date(now.getTime() - 24 * 3600_000)
  const events = await deps.store.eventsCreatedBetween(since, now)
  if (events.length === 0 && p.dailySkipEmpty) {
    await deps.store.saveLastSummary(now)
    return "nothing"
  }
  try {
    const message = summaryMessage({
      since,
      until: now,
      events,
      disk: await deps.disk().catch(() => null),
      devices: deviceLines(await deps.store.devices()),
      publicUrl: ctx.publicUrl,
    })
    if ((await deps.send(ctx, message)) !== "sent") return "skipped"
    await deps.store.saveLastSummary(now)
    return "sent"
  } catch (error) {
    deps.log(`daily summary failed: ${describe(error)}`)
    return "failed"
  }
}

/**
 * Device alerts, debounced: a condition mails once when it starts and is
 * remembered (alert*At) until it clears, so a restart never repeats it.
 */
export async function runDeviceAlerts(deps: NotifyDeps): Promise<number> {
  const ctx = await deps.context()
  const p = ctx.prefs
  if (!p.notifyAlerts) return 0
  const now = deps.now()
  const canSend = ctx.mode !== "not-configured" && ctx.recipients.length > 0
  let sent = 0
  for (const d of await deps.store.devices()) {
    if (d.revokedAt) continue
    const s = parseStatus(d.lastStatus)
    const conditions: {
      kind: AlertKind
      field: keyof DeviceAlertPatch
      active: boolean
      text: string
    }[] = [
      {
        kind: "lowBattery",
        field: "alertLowBatteryAt",
        active:
          typeof s.battery_v === "number" && s.battery_v < p.alertBatteryV,
        text: `The battery is low: ${s.battery_v} V (alert below ${p.alertBatteryV} V).`,
      },
      {
        kind: "lowCard",
        field: "alertLowCardAt",
        active:
          typeof s.free_bytes === "number" &&
          s.free_bytes < p.alertCardGb * GIB,
        text: `The card is nearly full: ${((s.free_bytes ?? 0) / GIB).toFixed(1)} GB free (alert below ${p.alertCardGb} GB).`,
      },
      {
        kind: "offline",
        field: "alertOfflineAt",
        active:
          d.lastSeenAt !== null &&
          now.getTime() - d.lastSeenAt.getTime() >
            p.alertOfflineHours * 3600_000,
        text: `Not seen since ${d.lastSeenAt ? formatCarTime(d.lastSeenAt) : "ever"} UTC (alert after ${p.alertOfflineHours} h).`,
      },
    ]
    const patch: DeviceAlertPatch = {}
    const fresh: typeof conditions = []
    for (const c of conditions) {
      if (c.active && d[c.field] === null) fresh.push(c)
      else if (!c.active && d[c.field] !== null) patch[c.field] = null
    }
    if (fresh.length > 0 && canSend) {
      try {
        const result = await deps.send(
          ctx,
          alertMessage(d.name, fresh, ctx.publicUrl),
        )
        if (result === "sent") {
          for (const c of fresh) patch[c.field] = now
          sent++
        }
      } catch (error) {
        deps.log(`alert mail for ${d.name} failed: ${describe(error)}`)
      }
    }
    if (Object.keys(patch).length > 0) await deps.store.patchDevice(d.id, patch)
  }
  return sent
}

export type TestResult =
  { ok: true; to: string[] } | { ok: false; error: string }

export async function sendTest(
  ctx: MailContext,
  send: NotifyDeps["send"],
  describeError: (e: unknown) => string,
): Promise<TestResult> {
  if (ctx.mode === "not-configured")
    return { ok: false, error: "Mail is not configured: set an SMTP host." }
  if (ctx.recipients.length === 0)
    return {
      ok: false,
      error: "There is no recipient: set NOTIFY_TO or add one.",
    }
  try {
    await send(ctx, testMessage(ctx.publicUrl))
    return { ok: true, to: ctx.recipients }
  } catch (error) {
    return { ok: false, error: describeError(error) }
  }
}
