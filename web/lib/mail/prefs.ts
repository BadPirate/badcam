// The stored mail settings: types and defaults, safe to import anywhere.
import type { SmtpOverrides } from "./config"

export type NotifyPrefs = {
  notifySentry: boolean
  notifySaved: boolean
  notifyDaily: boolean
  dailyTime: string
  dailySkipEmpty: boolean
  lastSummaryAt: Date | null
  notifyAlerts: boolean
  alertBatteryV: number
  alertCardGb: number
  alertOfflineHours: number
}

export type StoredMail = NotifyPrefs &
  SmtpOverrides & { recipients: string | null }

export const DEFAULT_PREFS: NotifyPrefs = {
  notifySentry: true,
  notifySaved: true,
  notifyDaily: true,
  dailyTime: "08:00",
  dailySkipEmpty: true,
  lastSummaryAt: null,
  notifyAlerts: false,
  alertBatteryV: 3.5,
  alertCardGb: 5,
  alertOfflineHours: 24,
}
