// The database side of mail settings and notifications.
import { db } from "../db"
import type { SmtpOverrides } from "./config"
import { DEFAULT_PREFS, type StoredMail } from "./prefs"
import { buildContext, type MailContext } from "./send"

const ID = "singleton"

export async function getStoredMail(): Promise<StoredMail> {
  const row = await db.notificationSettings.findUnique({ where: { id: ID } })
  if (!row) {
    return {
      ...DEFAULT_PREFS,
      smtpHost: null,
      smtpPort: null,
      smtpSecure: null,
      smtpUser: null,
      smtpPasswordSealed: null,
      smtpFrom: null,
      smtpReplyTo: null,
      recipients: null,
    }
  }
  const { id: _id, updatedAt: _updatedAt, ...rest } = row
  return rest
}

export async function patchStoredMail(
  data: Partial<StoredMail> & Partial<SmtpOverrides>,
): Promise<void> {
  await db.notificationSettings.upsert({
    where: { id: ID },
    create: { id: ID, ...data },
    update: data,
  })
}

export async function loadMailContext(): Promise<MailContext> {
  return buildContext(await getStoredMail())
}
