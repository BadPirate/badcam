"use server"

import { revalidatePath } from "next/cache"

import { createDevice } from "@/lib/auth/device"
import { requireOwner } from "@/lib/auth/session"
import { db } from "@/lib/db"

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
