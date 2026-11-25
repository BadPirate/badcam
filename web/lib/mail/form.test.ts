import { describe, expect, it } from "vitest"

import { parseNotifyForm, parseSmtpForm } from "./form"

describe("smtp form", () => {
  it("treats empty fields as use-the-environment", () => {
    const r = parseSmtpForm({ smtpHost: "", smtpPort: "", smtpSecure: "" })
    expect(r).toMatchObject({
      ok: true,
      patch: {
        smtpHost: null,
        smtpPort: null,
        smtpSecure: null,
        recipients: null,
      },
      newPassword: null,
      clearPassword: false,
    })
  })
  it("parses values and validates", () => {
    const r = parseSmtpForm({
      smtpHost: "smtp.example.com",
      smtpPort: "465",
      smtpSecure: "true",
      recipients: "a@example.com\nb@example.com",
      smtpPassword: "pw",
    })
    expect(r).toMatchObject({
      ok: true,
      patch: {
        smtpPort: 465,
        smtpSecure: true,
        recipients: "a@example.com, b@example.com",
      },
      newPassword: "pw",
    })
    expect(
      parseSmtpForm({ smtpPort: "70000", recipients: "nope" }),
    ).toMatchObject({
      ok: false,
      errors: { smtpPort: expect.any(String), recipients: expect.any(String) },
    })
  })
})

describe("notification form", () => {
  it("reads switches as booleans and validates thresholds", () => {
    const r = parseNotifyForm({
      notifySentry: "on",
      dailyTime: "08:00",
      alertBatteryV: "3.5",
      alertCardGb: "5",
      alertOfflineHours: "24",
    })
    expect(r).toMatchObject({
      ok: true,
      prefs: { notifySentry: true, notifySaved: false, notifyAlerts: false },
    })
    expect(
      parseNotifyForm({
        dailyTime: "25:00",
        alertBatteryV: "x",
        alertCardGb: "-1",
        alertOfflineHours: "0",
      }).ok,
    ).toBe(false)
  })
})
