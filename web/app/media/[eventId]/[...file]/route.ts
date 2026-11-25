import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"

import { isOwnerRequest } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { originalPath, stitchedDir } from "@/lib/storage/layout"
import { parseHttpRange } from "@/lib/storage/range"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
}
const ORIG_RE = /^[A-Za-z0-9._-]{1,80}$/

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string; file: string[] }> },
) {
  if (!isOwnerRequest(request))
    return new Response("Unauthorized", { status: 401 })
  const { eventId, file } = await params

  let target: string | null = null
  let download: string | null = null

  if (
    file.length === 1 &&
    ["event.mp4", "poster.jpg", "highlight.mp4"].includes(file[0] as string)
  ) {
    target = path.join(stitchedDir(eventId), file[0] as string)
  }

  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { id: true, deviceId: true, deletedAt: true },
  })
  if (!event || event.deletedAt)
    return new Response("Not found", { status: 404 })

  if (
    file.length === 2 &&
    file[0] === "orig" &&
    ORIG_RE.test(file[1] as string) &&
    file[1] !== "." &&
    file[1] !== ".."
  ) {
    const name = file[1] as string
    const clip = await db.clip.findFirst({
      where: { eventId, fileDeleted: false, path: { endsWith: `/${name}` } },
      select: { path: true },
    })
    if (clip && clip.path.split("/").at(-1) === name) {
      target = originalPath(event.deviceId, clip.path)
      download = name
    }
  }
  if (!target) return new Response("Not found", { status: 404 })

  let size: number
  try {
    size = (await stat(/*turbopackIgnore: true*/ target)).size
  } catch {
    return new Response("Not found", { status: 404 })
  }

  const headers: Record<string, string> = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "Content-Type": TYPES[path.extname(target)] ?? "application/octet-stream",
  }
  if (download)
    headers["Content-Disposition"] = `attachment; filename="${download}"`

  const range = parseHttpRange(request.headers.get("range"), size)
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { ...headers, "Content-Range": `bytes */${size}` },
    })
  }
  if (range) {
    const length = range.end - range.start + 1
    return new Response(
      Readable.toWeb(
        createReadStream(/*turbopackIgnore: true*/ target, {
          start: range.start,
          end: range.end,
        }),
      ) as ReadableStream,
      {
        status: 206,
        headers: {
          ...headers,
          "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
          "Content-Length": String(length),
        },
      },
    )
  }
  return new Response(
    Readable.toWeb(
      createReadStream(/*turbopackIgnore: true*/ target),
    ) as ReadableStream,
    {
      status: 200,
      headers: { ...headers, "Content-Length": String(size) },
    },
  )
}
