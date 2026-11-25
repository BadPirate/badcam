import { describe, expect, it } from "vitest"

import { createJobRunStore, type JobRunClient } from "./store"

function fakeClient() {
  const rows = new Map<string, { id: string; finished?: string }>()
  let n = 0
  const client: JobRunClient = {
    jobRun: {
      async create({ data }) {
        const key = `${data.name}|${data.runKey}`
        if (rows.has(key))
          throw Object.assign(new Error("unique"), { code: "P2002" })
        const row = { id: `id${++n}` }
        rows.set(key, row)
        return row
      },
      async update({ where, data }) {
        for (const row of rows.values())
          if (row.id === where.id) row.finished = data.outcome
      },
    },
  }
  return { client, rows }
}

describe("job run store", () => {
  it("claims a run once and answers null for the same run again", async () => {
    const { client } = fakeClient()
    const store = createJobRunStore(client)
    const first = await store.claim("stitch-sweep", "2026-11-22T12:00")
    expect(first).toBe("id1")
    expect(await store.claim("stitch-sweep", "2026-11-22T12:00")).toBeNull()
    expect(await store.claim("stitch-sweep", "2026-11-22T12:05")).toBe("id2")
    expect(await store.claim("retention", "2026-11-22T12:00")).toBe("id3")
  })

  it("records the outcome and rethrows other errors", async () => {
    const { client, rows } = fakeClient()
    const store = createJobRunStore(client)
    const id = await store.claim("disk-guard", "k")
    await store.finish(id as string, "done")
    expect(rows.get("disk-guard|k")?.finished).toBe("done")
    client.jobRun.create = async () => {
      throw new Error("db down")
    }
    await expect(store.claim("x", "y")).rejects.toThrow("db down")
  })
})
