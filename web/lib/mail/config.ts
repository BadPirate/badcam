// Pure: merges the SMTP environment with the admin overrides stored in the
// database. Nothing here touches the database or the network, and nothing
// here returns a password to a caller that renders it.
import { createSecretBox } from "@kaperkunde/security"

export const SECRET_KEY_VARIABLE = "SETTINGS_SECRET_KEY"
export const SECRET_LABEL = "badcam:smtp-password"

export type Source = Record<string, string | undefined>

/** What the admin stored; null means "use the environment". */
export type SmtpOverrides = {
  smtpHost: string | null
  smtpPort: number | null
  smtpSecure: boolean | null
  smtpUser: string | null
  smtpPasswordSealed: string | null
  smtpFrom: string | null
  smtpReplyTo: string | null
}

export const NO_OVERRIDES: SmtpOverrides = {
  smtpHost: null,
  smtpPort: null,
  smtpSecure: null,
  smtpUser: null,
  smtpPasswordSealed: null,
  smtpFrom: null,
  smtpReplyTo: null,
}

export type FieldSource = "env" | "custom" | "unset"
export type PasswordState = "env" | "custom" | "unset" | "unreadable" // sealed, but the key is gone or changed

export type EffectiveSmtp = {
  /** An SMTP_* environment for createMailer, password included. Never render it. */
  env: Source
  /** A host is set, by the environment or the admin. */
  hostConfigured: boolean
  /** Safe to render: no password. */
  view: {
    host: string
    port: string
    secure: string
    user: string
    from: string
    replyTo: string
    sources: Record<
      "host" | "port" | "secure" | "user" | "from" | "replyTo",
      FieldSource
    >
    password: PasswordState
  }
  keyConfigured: boolean
}

const clean = (v: string | null | undefined) => v?.trim() || undefined

export function parseBool(v: string | undefined): boolean | undefined {
  const t = v?.trim().toLowerCase()
  if (t === "true" || t === "1" || t === "yes") return true
  if (t === "false" || t === "0" || t === "no") return false
  return undefined
}

export const secretBox = (source: Source) =>
  createSecretBox({
    keyVariable: SECRET_KEY_VARIABLE,
    label: SECRET_LABEL,
    env: source,
  })

export function resolveSmtp(
  source: Source,
  overrides: SmtpOverrides,
): EffectiveSmtp {
  const box = secretBox(source)
  const pick = <T>(custom: T | null, envValue: T | undefined) =>
    custom !== null && custom !== undefined
      ? { value: custom as T, from: "custom" as const }
      : envValue !== undefined
        ? { value: envValue, from: "env" as const }
        : { value: undefined, from: "unset" as const }

  const host = pick(clean(overrides.smtpHost) ?? null, clean(source.SMTP_HOST))
  const port = pick(
    overrides.smtpPort,
    clean(source.SMTP_PORT) ? Number(source.SMTP_PORT) : undefined,
  )
  const secure = pick(overrides.smtpSecure, parseBool(source.SMTP_SECURE))
  const user = pick(clean(overrides.smtpUser) ?? null, clean(source.SMTP_USER))
  const from = pick(clean(overrides.smtpFrom) ?? null, clean(source.SMTP_FROM))
  const replyTo = pick(
    clean(overrides.smtpReplyTo) ?? null,
    clean(source.SMTP_REPLY_TO),
  )

  const envPassword = source.SMTP_PASSWORD || source.SMTP_PASS || undefined
  let password: string | undefined
  let passwordState: PasswordState = "unset"
  if (overrides.smtpPasswordSealed) {
    try {
      password = box.open(overrides.smtpPasswordSealed)
      passwordState = "custom"
    } catch {
      passwordState = "unreadable"
    }
  } else if (envPassword) {
    password = envPassword
    passwordState = "env"
  }

  const env: Source = {}
  if (host.value) env.SMTP_HOST = host.value
  if (port.value !== undefined && Number.isFinite(port.value))
    env.SMTP_PORT = String(port.value)
  if (secure.value !== undefined) env.SMTP_SECURE = String(secure.value)
  if (user.value) env.SMTP_USER = user.value
  if (password) env.SMTP_PASSWORD = password
  if (from.value) env.SMTP_FROM = from.value
  if (replyTo.value) env.SMTP_REPLY_TO = replyTo.value

  return {
    env,
    hostConfigured: Boolean(host.value),
    keyConfigured: box.configured(),
    view: {
      host: host.value ?? "",
      port: port.value === undefined ? "" : String(port.value),
      secure: secure.value === undefined ? "" : String(secure.value),
      user: user.value ?? "",
      from: from.value ?? "",
      replyTo: replyTo.value ?? "",
      sources: {
        host: host.from,
        port: port.from,
        secure: secure.from,
        user: user.from,
        from: from.from,
        replyTo: replyTo.from,
      },
      password: passwordState,
    },
  }
}

export type MailMode = "configured" | "dev-fallback" | "not-configured"

/**
 * Without a host, production never falls back to localhost:1025: mail is
 * skipped. Development and tests may use the Mailpit the library defaults to.
 */
export function mailMode(smtp: EffectiveSmtp, source: Source): MailMode {
  if (smtp.hostConfigured) return "configured"
  return source.NODE_ENV === "production" ? "not-configured" : "dev-fallback"
}

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/

export function parseRecipients(text: string | null | undefined): {
  list: string[]
  invalid: string[]
} {
  const list: string[] = []
  const invalid: string[] = []
  for (const part of (text ?? "").split(/[\s,;]+/)) {
    const v = part.trim()
    if (!v) continue
    if (!EMAIL.test(v)) invalid.push(v)
    else if (!list.includes(v.toLowerCase()) && !list.includes(v)) list.push(v)
  }
  return { list, invalid }
}

/** The stored list when set, else NOTIFY_TO. */
export function effectiveRecipients(
  stored: string | null,
  notifyTo: string,
): { list: string[]; source: "custom" | "env" | "unset" } {
  const custom = parseRecipients(stored).list
  if (custom.length > 0) return { list: custom, source: "custom" }
  const fromEnv = parseRecipients(notifyTo).list
  return { list: fromEnv, source: fromEnv.length > 0 ? "env" : "unset" }
}
