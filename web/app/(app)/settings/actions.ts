"use server"

import { revalidatePath } from "next/cache"

import { createDevice } from "@/lib/auth/device"
import { requireOwner } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { secretBox } from "@/lib/mail/config"
import { parseNotifyForm, parseSmtpForm } from "@/lib/mail/form"
import { sendTest } from "@/lib/mail/notify"
import { deliver, safeError } from "@/lib/mail/send"
import { loadMailContext, patchStoredMail } from "@/lib/mail/store"
import { saveSettings } from "@/lib/settings"
import { parseSettings } from "@/lib/settings-fields"

export type AddDeviceState = {
  error: string | null
  token: string | null
  name: string | null
}

export async function addDevice(
  _: AddDeviceState,
  form: FormData,
): Promise<AddDeviceState> {
  await requireOwner()
  const name = String(form.get("name") ?? "").trim()
  if (!/^[A-Za-z0-9 ._-]{1,64}$/.test(name)) {
    return {
      error:
        "Use 1 to 64 letters, digits, spaces, dots, dashes or underscores.",
      token: null,
      name: null,
    }
  }
  if (await db.device.findUnique({ where: { name } })) {
    return { error: "A device with that name exists.", token: null, name: null }
  }
  const { token } = await createDevice(name)
  revalidatePath("/settings")
  return { error: null, token, name }
}

export async function revokeDevice(deviceId: string): Promise<void> {
  await requireOwner()
  await db.device.update({
    where: { id: deviceId },
    data: { revokedAt: new Date() },
  })
  revalidatePath("/settings")
}

export type SettingsState = {
  errors: Record<string, string>
  saved: boolean
}

export async function updateSettings(
  _: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  await requireOwner()
  const parsed = parseSettings(Object.fromEntries(form))
  if (!parsed.ok) return { errors: parsed.errors, saved: false }
  await saveSettings(parsed.settings)
  revalidatePath("/settings")
  return { errors: {}, saved: true }
}

export type MailState = {
  errors: Record<string, string>
  message: string | null
}

export async function updateMailSettings(
  _: MailState,
  form: FormData,
): Promise<MailState> {
  await requireOwner()
  const parsed = parseSmtpForm(Object.fromEntries(form))
  if (!parsed.ok) return { errors: parsed.errors, message: null }
  let sealed: string | null | undefined
  if (parsed.clearPassword) sealed = null
  else if (parsed.newPassword !== null) {
    const box = secretBox(process.env)
    if (!box.configured())
      return {
        errors: {
          smtpPassword:
            "SETTINGS_SECRET_KEY is not set, so a password cannot be stored.",
        },
        message: null,
      }
    sealed = box.seal(parsed.newPassword)
  }
  await patchStoredMail({
    ...parsed.patch,
    ...(sealed !== undefined ? { smtpPasswordSealed: sealed } : {}),
  })
  revalidatePath("/settings")
  return { errors: {}, message: "Saved." }
}

export async function updateNotifications(
  _: MailState,
  form: FormData,
): Promise<MailState> {
  await requireOwner()
  const parsed = parseNotifyForm(Object.fromEntries(form))
  if (!parsed.ok) return { errors: parsed.errors, message: null }
  await patchStoredMail(parsed.prefs)
  revalidatePath("/settings")
  return { errors: {}, message: "Saved." }
}

export async function sendTestEmail(): Promise<MailState> {
  await requireOwner()
  const ctx = await loadMailContext()
  const result = await sendTest(
    ctx,
    (c, m) => deliver(c, m),
    (e) => safeError(e, ctx),
  )
  return result.ok
    ? { errors: {}, message: `Test email sent to ${result.to.join(", ")}.` }
    : { errors: { test: result.error }, message: null }
}
