import { describe, expect, it } from "vitest"

import {
  SESSION_SECONDS,
  createSessionToken,
  verifySessionToken,
} from "./session"

const secret = "test-secret-test-secret-test-secret-0"
const now = new Date("2026-11-22T12:00:00Z")

describe("session tokens", () => {
  it("verifies a fresh token", () => {
    expect(
      verifySessionToken(secret, createSessionToken(secret, now), now),
    ).toBe(true)
  })
  it("expires after 30 days", () => {
    const token = createSessionToken(secret, now)
    const justBefore = new Date(now.getTime() + (SESSION_SECONDS - 5) * 1000)
    const after = new Date(now.getTime() + (SESSION_SECONDS + 5) * 1000)
    expect(verifySessionToken(secret, token, justBefore)).toBe(true)
    expect(verifySessionToken(secret, token, after)).toBe(false)
  })
  it("rejects other secrets, tampering, junk and empty input", () => {
    const token = createSessionToken(secret, now)
    expect(
      verifySessionToken("another-secret-another-secret-12345", token, now),
    ).toBe(false)
    expect(verifySessionToken(secret, `${token}x`, now)).toBe(false)
    expect(verifySessionToken(secret, "nope", now)).toBe(false)
    expect(verifySessionToken(secret, "", now)).toBe(false)
    expect(verifySessionToken(secret, null, now)).toBe(false)
    expect(verifySessionToken("", token, now)).toBe(false)
  })
})
