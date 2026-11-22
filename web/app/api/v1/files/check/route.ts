import { stat } from "node:fs/promises"

import { db } from "@/lib/db"
import { deviceOr401, readJson } from "@/lib/api"
import { partPath } from "@/lib/upload/receive"
import { parseContractPath } from "@/lib/tesla/paths"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Entry = { path: string; size: number }

export async function POST(request: Request) {
  const auth = await deviceOr401(request)
  if ("response" in auth) return auth.response
  const { device } = auth

  const body = await readJson(request)
  const files = body?.files
  if (!Array.isArray(files) || files.length > 500) {
    return Response.json({ error: "bad_request" }, { status: 400 })
  }
  const entries: Entry[] = []
  for (const f of files) {
    const e = f as { path?: unknown; size?: unknown }
    if (
      typeof e?.path !== "string" ||
      typeof e.size !== "number" ||
      !Number.isInteger(e.size) ||
      e.size < 0
    ) {
      return Response.json({ error: "bad_request" }, { status: 400 })
    }
    if (!parseContractPath(e.path).ok)
      return Response.json({ error: "bad_path" }, { status: 400 })
    entries.push({ path: e.path, size: e.size })
  }

  const clips = await db.clip.findMany({
    where: { deviceId: device.id, path: { in: entries.map((e) => e.path) } },
    select: { path: true, size: true, sha256: true },
  })
  const byPath = new Map(clips.map((c) => [c.path, c]))

  // Files of events the owner deleted count as complete, known or not.
  const keys = new Map<
    string,
    { kind: "SENTRY" | "SAVED" | "RECENT"; key: string }
  >()
  for (const e of entries) {
    const p = parseContractPath(e.path)
    if (p.ok)
      keys.set(`${p.parsed.kind}:${p.parsed.eventKey}`, {
        kind: p.parsed.kind,
        key: p.parsed.eventKey,
      })
  }
  const tombstones = keys.size
    ? await db.event.findMany({
        where: {
          deviceId: device.id,
          deletedAt: { not: null },
          OR: [...keys.values()].map((k) => ({ kind: k.kind, key: k.key })),
        },
        select: { kind: true, key: true },
      })
    : []
  const dead = new Set(tombstones.map((t) => `${t.kind}:${t.key}`))

  const out = await Promise.all(
    entries.map(async (e) => {
      const clip = byPath.get(e.path)
      if (clip)
        return {
          path: e.path,
          state: "complete",
          size: clip.size,
          sha256: clip.sha256,
        }
      const p = parseContractPath(e.path)
      if (p.ok && dead.has(`${p.parsed.kind}:${p.parsed.eventKey}`)) {
        return {
          path: e.path,
          state: "complete",
          size: e.size,
          sha256: "0".repeat(64),
        }
      }
      try {
        const s = await stat(partPath(device.id, e.path))
        if (s.size > 0 && s.size < e.size)
          return { path: e.path, state: "partial", offset: s.size }
      } catch {
        // no partial
      }
      return { path: e.path, state: "missing", offset: 0 }
    }),
  )
  return Response.json({ files: out })
}
