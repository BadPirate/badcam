import { db } from "@/lib/db"
import { deviceOr401, readJson } from "@/lib/api"
import { getEnv } from "@/lib/env"
import { GIB, diskUsage } from "@/lib/storage/disk"
import { MAX_CHUNK_BYTES } from "@/lib/upload/receive"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const auth = await deviceOr401(request)
  if ("response" in auth) return auth.response
  const { device } = auth

  const body = (await readJson(request)) ?? {}
  await db.device.update({
    where: { id: device.id },
    data: {
      lastStatus: JSON.stringify(body).slice(0, 4000),
      lastSeenAt: new Date(),
    },
  })

  const { freeBytes } = await diskUsage(getEnv().dataDir)
  return Response.json({
    ok: true,
    device: device.name,
    time: new Date().toISOString(),
    max_chunk_bytes: MAX_CHUNK_BYTES,
    accepting: freeBytes >= GIB,
  })
}
