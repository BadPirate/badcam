import { createHash, randomBytes } from "node:crypto"
import { bearerToken } from "@kaperkunde/security"

import { db } from "../db"
import type { Device } from "../generated/prisma/client"

export const sha256Hex = (value: string) =>
  createHash("sha256").update(value).digest("hex")

export function newDeviceToken(): string {
  return `bc_${randomBytes(32).toString("base64url")}`
}

const TOKEN_RE = /^bc_[A-Za-z0-9_-]{43}$/
const SEEN_INTERVAL_MS = 60_000

/** The device a request's bearer token belongs to, or null. */
export async function authenticateDevice(
  request: Request,
): Promise<Device | null> {
  const token = bearerToken(request.headers.get("authorization"))
  if (!token || !TOKEN_RE.test(token)) return null
  const device = await db.device.findUnique({
    where: { tokenHash: sha256Hex(token) },
  })
  if (!device || device.revokedAt) return null
  const now = Date.now()
  if (
    !device.lastSeenAt ||
    now - device.lastSeenAt.getTime() > SEEN_INTERVAL_MS
  ) {
    await db.device.update({
      where: { id: device.id },
      data: { lastSeenAt: new Date(now) },
    })
  }
  return device
}

export async function createDevice(
  name: string,
): Promise<{ device: Device; token: string }> {
  const token = newDeviceToken()
  const device = await db.device.create({
    data: { name, tokenHash: sha256Hex(token) },
  })
  return { device, token }
}
