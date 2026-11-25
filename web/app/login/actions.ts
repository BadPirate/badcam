"use server"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import {
  checkRateLimit,
  clientIpFromHeaders,
  matchesSecret,
  refundRateLimit,
} from "@kaperkunde/security"

import {
  SESSION_COOKIE,
  SESSION_SECONDS,
  createSessionToken,
} from "@/lib/auth/session"
import { getEnv } from "@/lib/env"

export type LoginState = { error: string | null }

export async function login(
  _: LoginState,
  form: FormData,
): Promise<LoginState> {
  const ip = clientIpFromHeaders(await headers())
  const key = `login:${ip}`
  const limit = checkRateLimit(key, { max: 5, windowMs: 900_000 })
  if (!limit.allowed) {
    return {
      error: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterMs / 60_000)} minutes.`,
    }
  }

  const env = getEnv()
  const password = String(form.get("password") ?? "")
  if (!matchesSecret(password, env.ownerPassword))
    return { error: "Wrong password." }

  refundRateLimit(key)
  const jar = await cookies()
  jar.set(SESSION_COOKIE, createSessionToken(env.sessionSecret), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_SECONDS,
  })
  redirect("/")
}

export async function logout(): Promise<void> {
  const jar = await cookies()
  jar.delete(SESSION_COOKIE)
  redirect("/login")
}
