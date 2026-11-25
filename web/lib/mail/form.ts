// Pure parsing of the mail settings forms (text in, validated values out).
import { parseRecipients } from "./config"
import { isClock } from "./time"
import type { NotifyPrefs } from "./prefs"

type Input = Record<string, unknown>
const text = (input: Input, key: string) => String(input[key] ?? "").trim()
const on = (input: Input, key: string) => input[key] === "on"

export type SmtpPatch = {
  smtpHost: string | null
  smtpPort: number | null
  smtpSecure: boolean | null
  smtpUser: string | null
  smtpFrom: string | null
  smtpReplyTo: string | null
  recipients: string | null
}

export type SmtpForm =
  | {
      ok: true
      patch: SmtpPatch
      /** A new password to seal, or null to leave it alone. */
      newPassword: string | null
      clearPassword: boolean
    }
  | { ok: false; errors: Record<string, string> }

/** An empty field means "use the environment value" (null). */
export function parseSmtpForm(input: Input): SmtpForm {
  const errors: Record<string, string> = {}
  const host = text(input, "smtpHost")
  if (host && !/^[A-Za-z0-9.-]{1,255}$/.test(host))
    errors.smtpHost = "Enter a host name such as smtp.example.com."
  const portText = text(input, "smtpPort")
  let port: number | null = null
  if (portText) {
    port = Number(portText)
    if (!/^\d{1,5}$/.test(portText) || port < 1 || port > 65535)
      errors.smtpPort = "Enter a port from 1 to 65535."
  }
  const secureText = text(input, "smtpSecure")
  if (secureText && secureText !== "true" && secureText !== "false")
    errors.smtpSecure = "Choose one of the options."
  const from = text(input, "smtpFrom")
  if (from.length > 255 || /[\r\n]/.test(from))
    errors.smtpFrom = "Enter a sender such as Badcam <badcam@example.com>."
  const replyTo = text(input, "smtpReplyTo")
  if (replyTo.length > 255 || /[\r\n]/.test(replyTo))
    errors.smtpReplyTo = "Enter an address such as owner@example.com."
  const user = text(input, "smtpUser")
  if (user.length > 255 || /[\r\n]/.test(user))
    errors.smtpUser = "That user name is too long."
  const recipients = parseRecipients(text(input, "recipients"))
  if (recipients.invalid.length > 0)
    errors.recipients = `Not an email address: ${recipients.invalid.slice(0, 3).join(", ")}`
  if (recipients.list.length > 10) errors.recipients = "At most 10 recipients."
  const password = String(input.smtpPassword ?? "")
  if (password.length > 1000) errors.smtpPassword = "That password is too long."
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    patch: {
      smtpHost: host || null,
      smtpPort: port,
      smtpSecure: secureText === "" ? null : secureText === "true",
      smtpUser: user || null,
      smtpFrom: from || null,
      smtpReplyTo: replyTo || null,
      recipients:
        recipients.list.length > 0 ? recipients.list.join(", ") : null,
    },
    newPassword: password === "" ? null : password,
    clearPassword: on(input, "clearSmtpPassword"),
  }
}

export type NotifyForm =
  | { ok: true; prefs: Omit<NotifyPrefs, "lastSummaryAt"> }
  | { ok: false; errors: Record<string, string> }

export function parseNotifyForm(input: Input): NotifyForm {
  const errors: Record<string, string> = {}
  const dailyTime = text(input, "dailyTime")
  if (!isClock(dailyTime)) errors.dailyTime = "Enter a time such as 08:00."
  const volts = Number(text(input, "alertBatteryV"))
  if (!text(input, "alertBatteryV") || !(volts > 0 && volts <= 60))
    errors.alertBatteryV = "Enter volts, for example 3.5."
  const gb = text(input, "alertCardGb")
  if (!/^\d{1,6}$/.test(gb)) errors.alertCardGb = "Enter a whole number of GB."
  const hours = text(input, "alertOfflineHours")
  if (!/^\d{1,5}$/.test(hours) || Number(hours) < 1)
    errors.alertOfflineHours = "Enter a whole number of hours, at least 1."
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    prefs: {
      notifySentry: on(input, "notifySentry"),
      notifySaved: on(input, "notifySaved"),
      notifyDaily: on(input, "notifyDaily"),
      dailyTime,
      dailySkipEmpty: on(input, "dailySkipEmpty"),
      notifyAlerts: on(input, "notifyAlerts"),
      alertBatteryV: volts,
      alertCardGb: Number(gb),
      alertOfflineHours: Number(hours),
    },
  }
}
