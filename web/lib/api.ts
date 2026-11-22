import { authenticateDevice } from "./auth/device"
import type { Device } from "./generated/prisma/client"

export const unauthorized = () =>
  Response.json({ error: "unauthorized" }, { status: 401 })

/** The device for this request, or the 401 to answer with. */
export async function deviceOr401(
  request: Request,
): Promise<{ device: Device } | { response: Response }> {
  const device = await authenticateDevice(request)
  return device ? { device } : { response: unauthorized() }
}

export async function readJson(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json()
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}
