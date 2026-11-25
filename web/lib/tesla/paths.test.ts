import { describe, expect, it } from "vitest"

import { eventKeyTime, parseContractPath, parseSegments } from "./paths"

const EV = "SentryClips/2026-11-20_18-22-10"

describe("parseContractPath", () => {
  it("accepts a clip, event.json, thumb.png and a RecentClips file", () => {
    const clip = parseContractPath(
      `${EV}/2026-11-20_18-21-10-left_repeater.mp4`,
    )
    expect(clip).toMatchObject({
      ok: true,
      parsed: {
        kind: "SENTRY",
        eventKey: "2026-11-20_18-22-10",
        minuteKey: "2026-11-20_18-21-10",
        camera: "left_repeater",
      },
    })
    expect(parseContractPath(`${EV}/event.json`)).toMatchObject({
      ok: true,
      parsed: { camera: null, minuteKey: null },
    })
    expect(
      parseContractPath("SavedClips/2026-11-20_18-22-10/thumb.png"),
    ).toMatchObject({ ok: true, parsed: { kind: "SAVED" } })
    expect(
      parseContractPath("RecentClips/2026-11-20_18-21-10-front.mp4"),
    ).toMatchObject({
      ok: true,
      parsed: { kind: "RECENT", eventKey: "2026-11-20_18" },
    })
  })

  it.each([
    "",
    "TeslaCam/SentryClips/2026-11-20_18-22-10/event.json",
    "/SentryClips/2026-11-20_18-22-10/event.json",
    "SentryClips/2026-11-20_18-22-10/../event.json",
    `${EV}/..`,
    `${EV}/.`,
    `${EV}/.hidden`,
    "SentryClips/../SentryClips/2026-11-20_18-22-10/event.json",
    "SentryClips/2026-11-20/event.json",
    `${EV}/sub/event.json`,
    `${EV}/ev ent.json`,
    `${EV}\\event.json`,
    `${EV}/event.json/`,
    `${EV}//event.json`,
    "SentryClips/event.json",
    "OtherClips/2026-11-20_18-22-10/event.json",
    "RecentClips/notadate.mp4",
    "RecentClips/a/b.mp4",
    `${EV}/${"a".repeat(81)}`,
  ])("rejects %j", (p) => {
    expect(parseContractPath(p).ok).toBe(false)
  })

  it("rejects encoded slashes smuggled into a route segment", () => {
    expect(
      parseSegments(["SentryClips", "2026-11-20_18-22-10", "a/b"]).ok,
    ).toBe(false)
    expect(
      parseSegments(["SentryClips", "2026-11-20_18-22-10", "..%2Fevent.json"])
        .ok,
    ).toBe(false)
    expect(
      parseSegments(["SentryClips", "2026-11-20_18-22-10", "event.json"]).ok,
    ).toBe(true)
  })
})

describe("eventKeyTime", () => {
  it("reads car-local times as UTC", () => {
    expect(eventKeyTime("2026-11-20_18-22-10")?.toISOString()).toBe(
      "2026-11-20T18:22:10.000Z",
    )
    expect(eventKeyTime("2026-11-20_18")?.toISOString()).toBe(
      "2026-11-20T18:00:00.000Z",
    )
    expect(eventKeyTime("2026-13-40_18-22-10")).toBeNull()
  })
})
