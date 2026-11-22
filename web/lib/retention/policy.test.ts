import { describe, expect, it } from "vitest"

import {
  retentionAction,
  type RetentionConfig,
  type RetentionEvent,
} from "./policy"

const now = new Date("2026-12-01T00:00:00Z")
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000)
const cfg: RetentionConfig = {
  sentryDays: 30,
  savedDays: 90,
  recentDays: 7,
  originalsDays: 14,
}
const event = (o: Partial<RetentionEvent> = {}): RetentionEvent => ({
  kind: "SENTRY",
  startedAt: daysAgo(1),
  starred: false,
  stitchStatus: "DONE",
  stitchedAt: daysAgo(1),
  originalsDeleted: false,
  deleted: false,
  ...o,
})

describe("retentionAction", () => {
  it.each([
    ["SENTRY", 29, "delete-originals"],
    ["SENTRY", 31, "delete-event"],
    ["SAVED", 31, "delete-originals"],
    ["SAVED", 89, "delete-originals"],
    ["SAVED", 91, "delete-event"],
    ["RECENT", 6, "delete-originals"],
    ["RECENT", 8, "delete-event"],
  ] as const)(
    "%s event %i days old with an old stitch: %s",
    (kind, age, expected) => {
      expect(
        retentionAction(
          event({ kind, startedAt: daysAgo(age), stitchedAt: daysAgo(20) }),
          cfg,
          now,
        ),
      ).toBe(expected)
    },
  )

  it("never touches starred or already deleted events", () => {
    expect(
      retentionAction(
        event({ starred: true, startedAt: daysAgo(500) }),
        cfg,
        now,
      ),
    ).toBe("keep")
    expect(
      retentionAction(
        event({ deleted: true, startedAt: daysAgo(500) }),
        cfg,
        now,
      ),
    ).toBe("keep")
  })

  it("removes originals 14 days after a successful stitch, not before", () => {
    expect(retentionAction(event({ stitchedAt: daysAgo(13) }), cfg, now)).toBe(
      "keep",
    )
    expect(retentionAction(event({ stitchedAt: daysAgo(15) }), cfg, now)).toBe(
      "delete-originals",
    )
    expect(
      retentionAction(
        event({ stitchedAt: daysAgo(15), originalsDeleted: true }),
        cfg,
        now,
      ),
    ).toBe("keep")
  })

  it("keeps originals of events that did not stitch, until the event expires", () => {
    for (const stitchStatus of [
      "FAILED",
      "PENDING",
      "QUEUED",
      "RUNNING",
    ] as const) {
      expect(
        retentionAction(
          event({ stitchStatus, stitchedAt: null, startedAt: daysAgo(20) }),
          cfg,
          now,
        ),
      ).toBe("keep")
    }
    expect(
      retentionAction(
        event({
          stitchStatus: "FAILED",
          stitchedAt: null,
          startedAt: daysAgo(31),
        }),
        cfg,
        now,
      ),
    ).toBe("delete-event")
  })

  it("a value of 0 disables that rule", () => {
    const off = { ...cfg, sentryDays: 0, originalsDays: 0 }
    expect(
      retentionAction(
        event({ startedAt: daysAgo(400), stitchedAt: daysAgo(400) }),
        off,
        now,
      ),
    ).toBe("keep")
    expect(
      retentionAction(
        event({
          kind: "SAVED",
          startedAt: daysAgo(100),
          stitchedAt: daysAgo(100),
        }),
        off,
        now,
      ),
    ).toBe("delete-event")
  })
})
