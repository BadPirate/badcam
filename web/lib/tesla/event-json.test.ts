import { describe, expect, it } from "vitest"

import { parseEventJson } from "./event-json"

describe("parseEventJson", () => {
  it("reads the fields Tesla writes, timestamp as UTC", () => {
    const e = parseEventJson(
      '{"timestamp":"2026-11-20T18:22:10","city":"Amsterdam","est_lat":"52.37","est_lon":"4.90","reason":"sentry_aware_object_detection","camera":"0"}',
    )
    expect(e.timestamp?.toISOString()).toBe("2026-11-20T18:22:10.000Z")
    expect(e).toMatchObject({
      city: "Amsterdam",
      lat: 52.37,
      lon: 4.9,
      reason: "sentry_aware_object_detection",
      camera: "0",
    })
  })
  it("is lenient: every field optional, bad values dropped", () => {
    expect(parseEventJson("{}")).toEqual({
      timestamp: null,
      city: null,
      lat: null,
      lon: null,
      reason: null,
      camera: null,
    })
    expect(parseEventJson("not json")).toMatchObject({
      timestamp: null,
      city: null,
    })
    expect(parseEventJson("[1,2]")).toMatchObject({ lat: null })
    const e = parseEventJson(
      '{"timestamp":"yesterday","est_lat":"north","est_lon":"999","city":"  "}',
    )
    expect(e).toMatchObject({
      timestamp: null,
      lat: null,
      lon: null,
      city: null,
    })
  })
  it("tolerates a BOM and numeric values", () => {
    const e = parseEventJson('﻿{"est_lat":52.1,"est_lon":4.2}')
    expect(e).toMatchObject({ lat: 52.1, lon: 4.2 })
  })
})
