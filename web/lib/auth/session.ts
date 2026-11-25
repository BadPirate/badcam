import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { createLinkTokens } from "@kaperkunde/security"

import { getEnv } from "../env"

export const SESSION_COOKIE = "badcam_session"
export const SESSION_SECONDS = 30 * 24 * 3600

const tokens = (secret: string) =>
  createLinkTokens({ secret, label: "badcam-session" })

/** A signed `owner:<expiry epoch seconds>` token. */
export function createSessionToken(
  secret: string,
  now: Date = new Date(),
): string {
  const expires = Math.floor(now.getTime() / 1000) + SESSION_SECONDS
  return tokens(secret).tokenFor(`owner:${expires}`)
}

export function verifySessionToken(
  secret: string,
  token: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!secret || !token) return false
  const subject = tokens(secret).subjectOf(token)
  if (!subject?.startsWith("owner:")) return false
  const expires = Number(subject.slice("owner:".length))
  return Number.isFinite(expires) && expires > now.getTime() / 1000
}

/** For route handlers: whether this request carries a valid owner cookie. */
export function isOwnerRequest(request: Request): boolean {
  const header = request.headers.get("cookie") ?? ""
  const match = header
    .split(/;\s*/)
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
  const value = match
    ? decodeURIComponent(match.slice(SESSION_COOKIE.length + 1))
    : null
  return verifySessionToken(getEnv().sessionSecret, value)
}

/** For pages and server actions: redirects to /login without a valid cookie. */
export async function requireOwner(): Promise<void> {
  const jar = await cookies()
  if (
    !verifySessionToken(getEnv().sessionSecret, jar.get(SESSION_COOKIE)?.value)
  ) {
    redirect("/login")
  }
}
