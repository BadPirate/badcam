import { describe, expect, it } from "vitest"

import { eventMessage, summaryMessage } from "./content"
import {
  notifyEventReady,
  retryUnsent,
  runDailySummary,
  runDeviceAlerts,
  type DeviceRow,
  type EventRow,
  type NotifyDeps,
} from "./notify"
import { buildContext, type MailContext } from "./send"
import { DEFAULT_PREFS, type StoredMail } from "./prefs"
import { NO_OVERRIDES } from "./config"
import type { Message } from "./content"

const ENV = { SMTP_HOST: "smtp.example.com", NODE_ENV: "production" }
const NOW = new Date("2026-11-25T07:30:00Z") // 08:30 in Amsterdam

function event(over: Partial<EventRow> = {}): EventRow {
  return {
    id: "e1",
    kind: "SENTRY",
    startedAt: new Date("2026-11-24T18:22:10Z"),
    triggerAt: new Date("2026-11-24T18:22:40Z"),
    city: "Amsterdam",
    lat: 52.37,
    lon: 4.89,
    reason: "sentry_aware_object_detection",
    camera: "front",
    durationSec: 95,
    deviceName: "car",
    stitchStatus: "DONE",
    notifiedAt: null,
    deletedAt: null,
    ...over,
  }
}

function device(over: Partial<DeviceRow> = {}): DeviceRow {
  return {
    id: "d1",
    name: "car",
    lastSeenAt: NOW,
    lastStatus: JSON.stringify({
      state: "idle",
      battery_v: 3.9,
      free_bytes: 50 * 1024 ** 3,
    }),
    revokedAt: null,
    alertLowBatteryAt: null,
    alertLowCardAt: null,
    alertOfflineAt: null,
    ...over,
  }
}

function harness(opts: {
  stored?: Partial<StoredMail>
  env?: Record<string, string>
  events?: EventRow[]
  devices?: DeviceRow[]
  failSend?: boolean
  now?: Date
}) {
  const events = new Map((opts.events ?? []).map((e) => [e.id, e]))
  const devices = opts.devices ?? []
  const sent: Message[] = []
  const state = {
    lastSummary: opts.stored?.lastSummaryAt ?? null,
    fail: opts.failSend ?? false,
  }
  const logs: string[] = []
  const ctx = (): MailContext =>
    buildContext(
      {
        ...DEFAULT_PREFS,
        ...NO_OVERRIDES,
        recipients: "owner@example.com",
        ...opts.stored,
        lastSummaryAt: state.lastSummary,
      },
      { ...ENV, ...opts.env },
    )
  const deps: NotifyDeps = {
    store: {
      getEvent: async (id) => events.get(id) ?? null,
      claimEvent: async (id, now) => {
        const e = events.get(id)
        if (!e || e.notifiedAt) return false
        e.notifiedAt = now
        return true
      },
      releaseEvent: async (id) => void (events.get(id)!.notifiedAt = null),
      unsentEventIds: async (after) =>
        [...events.values()]
          .filter(
            (e) =>
              e.stitchStatus === "DONE" &&
              !e.notifiedAt &&
              e.startedAt >= after,
          )
          .map((e) => e.id),
      eventsCreatedBetween: async () => [...events.values()],
      devices: async () => devices,
      patchDevice: async (id, patch) =>
        void Object.assign(
          devices.find((d) => d.id === id)!,
          patch,
        ),
      saveLastSummary: async (at) => void (state.lastSummary = at),
    },
    context: async () => ctx(),
    send: async (_c, m) => {
      if (state.fail) throw new Error("connection refused")
      sent.push(m)
      return "sent"
    },
    disk: async () => ({ usedBytes: 40e9, totalBytes: 100e9, freeBytes: 60e9 }),
    now: () => opts.now ?? NOW,
    log: (m) => void logs.push(m),
  }
  return { deps, sent, events, devices, state, logs }
}

describe("event ready mail", () => {
  it("sends once per event, even when the stitch finishes again", async () => {
    const h = harness({ events: [event()] })
    expect(await notifyEventReady("e1", h.deps)).toBe("sent")
    expect(await notifyEventReady("e1", h.deps)).toBe("already")
    expect(h.sent).toHaveLength(1)
    expect(h.events.get("e1")!.notifiedAt).toEqual(NOW)
  })

  it("two racing sends produce one mail", async () => {
    const h = harness({ events: [event()] })
    await Promise.all([
      notifyEventReady("e1", h.deps),
      notifyEventReady("e1", h.deps),
    ])
    expect(h.sent).toHaveLength(1)
  })

  it("leaves notifiedAt null on failure and retries later", async () => {
    const h = harness({ events: [event()], failSend: true })
    expect(await notifyEventReady("e1", h.deps)).toBe("failed")
    expect(h.events.get("e1")!.notifiedAt).toBeNull()
    expect(h.logs[0]).toContain("connection refused")
    h.state.fail = false
    expect(await retryUnsent(h.deps)).toBe(1)
    expect(h.events.get("e1")!.notifiedAt).not.toBeNull()
  })

  it("does not retry events older than 24 hours", async () => {
    const h = harness({
      events: [event({ startedAt: new Date("2026-11-20T10:00:00Z") })],
    })
    expect(await retryUnsent(h.deps)).toBe(0)
  })

  it("skips when not configured, toggled off, or for other kinds", async () => {
    const off = harness({ events: [event()], env: { SMTP_HOST: "" } })
    expect(await notifyEventReady("e1", off.deps)).toBe("skipped")
    expect(off.events.get("e1")!.notifiedAt).toBeNull()
    const toggled = harness({
      events: [event()],
      stored: { notifySentry: false },
    })
    expect(await notifyEventReady("e1", toggled.deps)).toBe("skipped")
    const saved = harness({
      events: [event({ kind: "SAVED" })],
      stored: { notifySentry: false },
    })
    expect(await notifyEventReady("e1", saved.deps)).toBe("sent")
    const recent = harness({ events: [event({ kind: "RECENT" })] })
    expect(await notifyEventReady("e1", recent.deps)).toBe("skipped")
  })

  it("builds the mail with link, place, reason and device", () => {
    const m = eventMessage(event(), "https://badcam.example.com")
    expect(m.cta?.url).toBe("https://badcam.example.com/events/e1")
    expect(m.subject).toContain("Amsterdam")
    expect(JSON.stringify(m.paragraphs)).toContain(
      "sentry aware object detection",
    )
    expect(JSON.stringify(m.paragraphs)).toContain("1:35")
    expect(m.secondaryLink?.url).toContain("openstreetmap.org")
  })
})

describe("daily summary", () => {
  it("sends after the configured time, with counts, links, storage and device", async () => {
    const h = harness({
      events: [event(), event({ id: "e2", kind: "SAVED" })],
      devices: [device()],
      env: { PUBLIC_URL: "https://badcam.example.com" },
    })
    expect(await runDailySummary(h.deps)).toBe("sent")
    const m = h.sent[0]!
    expect(m.subject).toContain("1 Sentry, 1 saved")
    expect(m.links?.map((l) => l.url)).toEqual([
      "https://badcam.example.com/events/e1",
      "https://badcam.example.com/events/e2",
    ])
    const body = JSON.stringify(m.paragraphs)
    expect(body).toContain("37 GB used")
    expect(body).toContain("battery 3.9 V")
    expect(body).toContain("last seen")
    expect(h.state.lastSummary).toEqual(NOW)
    expect(await runDailySummary(h.deps)).toBe("already")
  })

  it("waits until the time, skips an empty day when asked, and retries a failure", async () => {
    const early = harness({ events: [event()], stored: { dailyTime: "09:00" } })
    expect(await runDailySummary(early.deps)).toBe("not-yet")
    const empty = harness({})
    expect(await runDailySummary(empty.deps)).toBe("nothing")
    expect(empty.sent).toHaveLength(0)
    const quiet = harness({ stored: { dailySkipEmpty: false } })
    expect(await runDailySummary(quiet.deps)).toBe("sent")
    const failing = harness({ events: [event()], failSend: true })
    expect(await runDailySummary(failing.deps)).toBe("failed")
    expect(failing.state.lastSummary).toBeNull()
    expect(
      await runDailySummary(harness({ stored: { notifyDaily: false } }).deps),
    ).toBe("off")
  })

  it("caps the link list", () => {
    const events = Array.from({ length: 30 }, (_, i) => event({ id: `e${i}` }))
    const m = summaryMessage({
      since: NOW,
      until: NOW,
      events,
      disk: null,
      devices: [],
      publicUrl: "https://badcam.example.com",
    })
    expect(m.links).toHaveLength(25)
    expect(JSON.stringify(m.paragraphs)).toContain("And 5 more")
  })
})

describe("device alerts", () => {
  const low = JSON.stringify({ battery_v: 3.2, free_bytes: 50 * 1024 ** 3 })
  const on = { notifyAlerts: true }

  it("is off by default", async () => {
    const h = harness({ devices: [device({ lastStatus: low })] })
    expect(await runDeviceAlerts(h.deps)).toBe(0)
  })

  it("alerts once per condition, persists it, and re-arms after it clears", async () => {
    const d = device({ lastStatus: low })
    const h = harness({ stored: on, devices: [d] })
    expect(await runDeviceAlerts(h.deps)).toBe(1)
    expect(d.alertLowBatteryAt).toEqual(NOW)
    expect(await runDeviceAlerts(h.deps)).toBe(0)
    expect(h.sent).toHaveLength(1)
    d.lastStatus = device().lastStatus
    await runDeviceAlerts(h.deps)
    expect(d.alertLowBatteryAt).toBeNull()
    d.lastStatus = low
    expect(await runDeviceAlerts(h.deps)).toBe(1)
  })

  it("covers low card and not-seen, and keeps the state unset when sending fails", async () => {
    const d = device({
      lastSeenAt: new Date("2026-11-23T00:00:00Z"),
      lastStatus: JSON.stringify({ battery_v: 4, free_bytes: 1024 ** 3 }),
    })
    const h = harness({ stored: on, devices: [d], failSend: true })
    expect(await runDeviceAlerts(h.deps)).toBe(0)
    expect(d.alertLowCardAt).toBeNull()
    h.state.fail = false
    expect(await runDeviceAlerts(h.deps)).toBe(1)
    expect(d.alertLowCardAt).not.toBeNull()
    expect(d.alertOfflineAt).not.toBeNull()
    expect(d.alertLowBatteryAt).toBeNull()
    expect(h.sent[0]!.paragraphs).toHaveLength(2)
  })
})
