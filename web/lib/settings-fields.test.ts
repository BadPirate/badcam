import { describe, expect, it } from "vitest"

import { parseSettings } from "./settings-fields"

const good = {
  retainSentryDays: "90",
  retainSavedDays: "0",
  retainRecentDays: "7",
  retainOriginalsDays: "14",
  minFreeGb: "5",
}

describe("parseSettings", () => {
  it("accepts integers from 0 up, trimming spaces", () => {
    expect(parseSettings({ ...good, retainSavedDays: " 0 " })).toEqual({
      ok: true,
      settings: {
        retainSentryDays: 90,
        retainSavedDays: 0,
        retainRecentDays: 7,
        retainOriginalsDays: 14,
        minFreeGb: 5,
      },
    })
  })
  it.each(["", "-1", "1.5", "abc", "1e3", "100001", "9999999", "0x10"])(
    "rejects %j and names the field",
    (bad) => {
      const r = parseSettings({ ...good, retainSentryDays: bad })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(Object.keys(r.errors)).toEqual(["retainSentryDays"])
    },
  )
  it("rejects missing fields", () => {
    const r = parseSettings({})
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r.errors)).toHaveLength(5)
  })
})
