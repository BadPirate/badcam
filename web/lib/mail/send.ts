import { createMailer, type SendEmailOptions } from "@kaperkunde/mail"
import { redact } from "@kaperkunde/security"

import { getEnv } from "../env"
import {
  effectiveRecipients,
  mailMode,
  resolveSmtp,
  type EffectiveSmtp,
  type MailMode,
  type Source,
} from "./config"
import type { Message } from "./content"
import { DEFAULT_PREFS, type NotifyPrefs, type StoredMail } from "./prefs"
import { mailTheme } from "./theme"

/** Everything a send needs, resolved from the environment and the database. */
export type MailContext = {
  smtp: EffectiveSmtp
  mode: MailMode
  recipients: string[]
  recipientSource: "custom" | "env" | "unset"
  prefs: NotifyPrefs
  publicUrl: string
}

export function buildContext(
  stored: StoredMail,
  source: Source = process.env,
): MailContext {
  const smtp = resolveSmtp(source, stored)
  const env = getEnv(source)
  const rec = effectiveRecipients(stored.recipients, env.notifyTo)
  return {
    smtp,
    mode: mailMode(smtp, source),
    recipients: rec.list,
    recipientSource: rec.source,
    prefs: { ...DEFAULT_PREFS, ...stored },
    publicUrl: env.publicUrl,
  }
}

export type Mailer = { send(options: SendEmailOptions): Promise<void> }
export type MailerFactory = (smtpEnv: Source, publicUrl: string) => Mailer

/** A fresh mailer per send: the library caches its transport, and the settings can change. */
export const libraryMailer: MailerFactory = (env, publicUrl) =>
  createMailer({
    prefix: "SMTP",
    defaultFrom: `Badcam <${env.SMTP_USER?.includes("@") ? env.SMTP_USER : "badcam@localhost"}>`,
    theme: mailTheme(publicUrl),
    env,
  })

export type Delivery = "sent" | "not-configured" | "no-recipients"

/**
 * Sends one message to every recipient in a single mail. Skips (never falls
 * back to localhost in production) when mail is not configured. Throws the
 * SMTP error otherwise; callers catch.
 */
export async function deliver(
  ctx: MailContext,
  message: Message,
  mailer: MailerFactory = libraryMailer,
): Promise<Delivery> {
  if (ctx.mode === "not-configured") return "not-configured"
  if (ctx.recipients.length === 0) return "no-recipients"
  const { subject, ...content } = message
  await mailer(ctx.smtp.env, ctx.publicUrl).send({
    ...content,
    subject,
    to: ctx.recipients.join(", "),
  })
  return "sent"
}

/** An error text that cannot carry the password or the user name. */
export function safeError(error: unknown, ctx: MailContext): string {
  const text = error instanceof Error ? error.message : String(error)
  return redact(text, [ctx.smtp.env.SMTP_PASSWORD, ctx.smtp.env.SMTP_USER])
    .replace(/\s+/g, " ")
    .slice(0, 300)
}
