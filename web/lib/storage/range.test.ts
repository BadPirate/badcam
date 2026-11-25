import { describe, expect, it } from "vitest"

import { parseContentRange, parseHttpRange } from "./range"

describe("parseHttpRange", () => {
  it("parses explicit, open and suffix ranges", () => {
    expect(parseHttpRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 })
    expect(parseHttpRange("bytes=900-", 1000)).toEqual({ start: 900, end: 999 })
    expect(parseHttpRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 })
    expect(parseHttpRange("bytes=0-5000", 1000)).toEqual({ start: 0, end: 999 })
  })
  it("flags unsatisfiable and ignores unusable headers", () => {
    expect(parseHttpRange("bytes=1000-", 1000)).toBe("unsatisfiable")
    expect(parseHttpRange("bytes=-0", 1000)).toBe("unsatisfiable")
    expect(parseHttpRange(null, 1000)).toBeNull()
    expect(parseHttpRange("items=0-1", 1000)).toBeNull()
    expect(parseHttpRange("bytes=0-1,5-6", 1000)).toBeNull()
    expect(parseHttpRange("bytes=9-3", 1000)).toBeNull()
  })
})

describe("parseContentRange", () => {
  it("parses a valid chunk", () => {
    expect(parseContentRange("bytes 0-8388607/31457280")).toEqual({
      start: 0,
      end: 8388607,
      total: 31457280,
    })
  })
  it.each([
    null,
    "",
    "bytes 0-9/*",
    "bytes 10-5/100",
    "bytes 0-100/100",
    "bytes 0-0/0",
    "0-9/10",
    "bytes -1-9/10",
  ])("rejects %j", (h) => {
    expect(parseContentRange(h)).toBeNull()
  })
})
