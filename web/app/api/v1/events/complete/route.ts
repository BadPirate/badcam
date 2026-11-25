import { db } from "@/lib/db"
import { deviceOr401, readJson } from "@/lib/api"
import { drain } from "@/lib/stitch/queue"
import { KINDS } from "@/lib/tesla/paths"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const auth = await deviceOr401(request)
  if ("response" in auth) return auth.response
  const { device } = auth

  const body = await readJson(request)
  const kind =
    body?.kind === "SentryClips" || body?.kind === "SavedClips"
      ? KINDS[body.kind]
      : null
  const key =
    typeof body?.event === "string" &&
    /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(body.event)
      ? body.event
      : null
  if (!kind || !key)
    return Response.json({ error: "bad_request" }, { status: 400 })

  const event = await db.event.findUnique({
    where: { deviceId_kind_key: { deviceId: device.id, kind, key } },
  })
  if (!event) return Response.json({ error: "unknown_event" }, { status: 404 })
  if (event.deletedAt) return Response.json({ ok: true, queued: false })

  const needsStitch =
    event.stitchStatus === "PENDING" || event.stitchStatus === "QUEUED"
  await db.event.update({
    where: { id: event.id },
    data: {
      uploadComplete: true,
      ...(event.stitchStatus === "PENDING" || event.stitchStatus === "QUEUED"
        ? { stitchStatus: "QUEUED" as const, stitchError: null }
        : {}),
    },
  })
  if (needsStitch) void drain()
  return Response.json({ ok: true, queued: true })
}
