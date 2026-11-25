// Usage: pnpm -s tsx scripts/push-fixtures.ts <dir> <baseUrl> <token>
// A minimal Pi-side client for end-to-end tests: uploads a TeslaCam/ tree
// with the v1 protocol (8 MiB chunks, resume, events/complete).
import { createHash } from "node:crypto"
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"

const [dir, baseUrl, token] = process.argv.slice(2)
if (!dir || !baseUrl || !token) {
  console.error("usage: push-fixtures.ts <dir> <baseUrl> <token>")
  process.exit(2)
}
const CHUNK = 8 * 1024 * 1024
const headers = { Authorization: `Bearer ${token}` }

async function api(method: string, url: string, init: RequestInit = {}) {
  const res = await fetch(new URL(url, baseUrl), {
    method,
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  })
  const text = await res.text()
  return {
    status: res.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  }
}

async function walk(root: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else out.push(full)
  }
  return out
}

const teslaRoot = path.join(dir, "TeslaCam")
const files = (await walk(teslaRoot))
  .map((f) => path.relative(teslaRoot, f).split(path.sep).join("/"))
  .sort()
const byEvent = new Map<string, string[]>()
for (const f of files) {
  const [top, folder] = f.split("/")
  if (top === "SentryClips" || top === "SavedClips")
    byEvent.set(`${top}/${folder}`, [
      ...(byEvent.get(`${top}/${folder}`) ?? []),
      f,
    ])
}

const ping = await api("POST", "/api/v1/ping", {
  body: "{}",
  headers: { "Content-Type": "application/json" },
})
if (ping.status !== 200) throw new Error(`ping failed: ${ping.status}`)

async function upload(rel: string): Promise<void> {
  const full = path.join(teslaRoot, rel)
  const data = await readFile(full)
  const total = data.length
  const sha = createHash("sha256").update(data).digest("hex")
  const url = `/api/v1/files/${rel.split("/").map(encodeURIComponent).join("/")}`
  let offset = 0
  for (let attempt = 0; attempt < 10; attempt++) {
    while (offset < total) {
      const end = Math.min(offset + CHUNK, total) - 1
      const last = end + 1 === total
      const res = await api("PUT", url, {
        body: data.subarray(offset, end + 1),
        headers: {
          "Content-Range": `bytes ${offset}-${end}/${total}`,
          "Content-Type": "application/octet-stream",
          ...(last ? { "X-Badcam-Sha256": sha } : {}),
        },
      })
      if (res.status === 202) offset = Number(res.body.offset)
      else if (res.status === 201 || res.status === 200) return
      else if (res.status === 409) offset = Number(res.body.offset)
      else if (res.status === 422) {
        offset = 0
        break
      } else
        throw new Error(
          `${rel}: unexpected ${res.status} ${JSON.stringify(res.body)}`,
        )
    }
  }
  throw new Error(`${rel}: gave up`)
}

for (const [event, list] of byEvent) {
  const check = await api("POST", "/api/v1/files/check", {
    body: JSON.stringify({
      files: await Promise.all(
        list.map(async (p) => ({
          path: p,
          size: (await stat(path.join(teslaRoot, p))).size,
        })),
      ),
    }),
    headers: { "Content-Type": "application/json" },
  })
  const states = new Map(
    (check.body.files as { path: string; state: string }[]).map((f) => [
      f.path,
      f.state,
    ]),
  )
  const order = (p: string) =>
    p.endsWith("event.json") ? 0 : p.endsWith("thumb.png") ? 1 : 2
  for (const rel of [...list].sort(
    (a, b) => order(a) - order(b) || a.localeCompare(b),
  )) {
    if (states.get(rel) === "complete") continue
    await upload(rel)
  }
  const [kind, folder] = event.split("/")
  const done = await api("POST", "/api/v1/events/complete", {
    body: JSON.stringify({ kind, event: folder, files: list.length }),
    headers: { "Content-Type": "application/json" },
  })
  console.log(`${event}: ${list.length} files, complete -> ${done.status}`)
}
