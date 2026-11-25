import { describe, expect, it } from "vitest"

import { getEnv, publicUrlFrom } from "../env"
import {
  effectiveRecipients,
  mailMode,
  NO_OVERRIDES,
  resolveSmtp,
  secretBox,
} from "./config"
import { deliver, buildContext, safeError } from "./send"
import { DEFAULT_PREFS } from "./prefs"

const KEY = Buffer.alloc(32, 7).toString("base64")
const ENV = {
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "465",
  SMTP_SECURE: "true",
  SMTP_USER: "badcam@example.com",
  SMTP_PASSWORD: "env-secret-pw",
  SETTINGS_SECRET_KEY: KEY,
}
const stored = (o = {}) => ({
  ...DEFAULT_PREFS,
  ...NO_OVERRIDES,
  recipients: null,
  ...o,
})

describe("smtp settings merge", () => {
  it("uses the environment when nothing is overridden", () => {
    const s = resolveSmtp(ENV, NO_OVERRIDES)
    expect(s.env).toMatchObject({
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "465",
      SMTP_SECURE: "true",
      SMTP_PASSWORD: "env-secret-pw",
    })
    expect(s.view.sources.host).toBe("env")
    expect(s.view.password).toBe("env")
    expect(JSON.stringify(s.view)).not.toContain("env-secret-pw")
  })

  it("lets a stored field override its env value, field by field", () => {
    const s = resolveSmtp(ENV, {
      ...NO_OVERRIDES,
      smtpHost: "mail.example.org",
      smtpSecure: false,
    })
    expect(s.env.SMTP_HOST).toBe("mail.example.org")
    expect(s.env.SMTP_SECURE).toBe("false")
    expect(s.env.SMTP_PORT).toBe("465")
    expect(s.view.sources).toMatchObject({ host: "custom", port: "env" })
  })

  it("seals the password and opens it only for the mailer", () => {
    const box = secretBox(ENV)
    const sealed = box.seal("custom-pw")
    expect(sealed).not.toContain("custom-pw")
    const s = resolveSmtp(ENV, { ...NO_OVERRIDES, smtpPasswordSealed: sealed })
    expect(s.env.SMTP_PASSWORD).toBe("custom-pw")
    expect(s.view.password).toBe("custom")
    expect(JSON.stringify(s.view)).not.toContain("custom-pw")
  })

  it("reports an unreadable password when the key changed", () => {
    const sealed = secretBox(ENV).seal("custom-pw")
    const other = {
      ...ENV,
      SETTINGS_SECRET_KEY: Buffer.alloc(32, 9).toString("base64"),
    }
    const s = resolveSmtp(other, {
      ...NO_OVERRIDES,
      smtpPasswordSealed: sealed,
    })
    expect(s.view.password).toBe("unreadable")
    expect(s.env.SMTP_PASSWORD).toBeUndefined()
  })

  it("accepts the 44-character base64 key and flags a missing one", () => {
    expect(KEY).toHaveLength(44)
    expect(resolveSmtp(ENV, NO_OVERRIDES).keyConfigured).toBe(true)
    expect(
      resolveSmtp({ ...ENV, SETTINGS_SECRET_KEY: "" }, NO_OVERRIDES)
        .keyConfigured,
    ).toBe(false)
  })

  it("recipients default to NOTIFY_TO and a stored list wins", () => {
    expect(
      effectiveRecipients(null, "a@example.com, b@example.com").list,
    ).toEqual(["a@example.com", "b@example.com"])
    expect(effectiveRecipients("c@example.com", "a@example.com")).toEqual({
      list: ["c@example.com"],
      source: "custom",
    })
    expect(effectiveRecipients(null, "").source).toBe("unset")
  })

  it("normalises PUBLIC_URL", () => {
    expect(publicUrlFrom("https://badcam.example.com/")).toBe(
      "https://badcam.example.com",
    )
    expect(publicUrlFrom("javascript:alert(1)")).toBe("")
    expect(getEnv({ NOTIFY_TO: " a@example.com " }).notifyTo).toBe(
      "a@example.com",
    )
  })
})

describe("not configured", () => {
  it("skips in production without a host, never using localhost", async () => {
    const ctx = buildContext(stored({ recipients: "a@example.com" }), {
      NODE_ENV: "production",
    })
    expect(ctx.mode).toBe("not-configured")
    let called = false
    const result = await deliver(
      ctx,
      { subject: "x", heading: "x", paragraphs: [], reason: "r" },
      () => {
        called = true
        return { send: async () => undefined }
      },
    )
    expect(result).toBe("not-configured")
    expect(called).toBe(false)
  })

  it("allows the Mailpit fallback only outside production", () => {
    const dev = resolveSmtp({}, NO_OVERRIDES)
    expect(mailMode(dev, { NODE_ENV: "development" })).toBe("dev-fallback")
    expect(mailMode(dev, { NODE_ENV: "production" })).toBe("not-configured")
    expect(
      mailMode(resolveSmtp(ENV, NO_OVERRIDES), { NODE_ENV: "production" }),
    ).toBe("configured")
  })

  it("a stored host alone makes mail configured", () => {
    const s = resolveSmtp({}, { ...NO_OVERRIDES, smtpHost: "smtp.example.com" })
    expect(mailMode(s, { NODE_ENV: "production" })).toBe("configured")
  })

  it("sends one mail to all recipients and scrubs credentials from errors", async () => {
    const ctx = buildContext(
      stored({ recipients: "a@example.com, b@example.com" }),
      ENV,
    )
    const sent: string[] = []
    await deliver(
      ctx,
      { subject: "s", heading: "h", paragraphs: ["p"], reason: "r" },
      () => ({
        send: async (o) => void sent.push(o.to),
      }),
    )
    expect(sent).toEqual(["a@example.com, b@example.com"])
    const text = safeError(
      new Error("auth failed for badcam@example.com with env-secret-pw"),
      ctx,
    )
    expect(text).not.toContain("env-secret-pw")
    expect(text).not.toContain("badcam@example.com")
  })
})
