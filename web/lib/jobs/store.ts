import { isUniqueViolation } from "@kaperkunde/next-kit/prisma"
import type { JobRunStore } from "@kaperkunde/next-kit/scheduler"

import { db } from "../db"

/** Same shape for tests: any object with these two Prisma-like calls. */
export type JobRunClient = {
  jobRun: {
    create(args: {
      data: { name: string; runKey: string }
    }): Promise<{ id: string }>
    update(args: {
      where: { id: string }
      data: { finishedAt: Date; outcome: string }
    }): Promise<unknown>
  }
}

export function createJobRunStore(
  client: JobRunClient = db as unknown as JobRunClient,
): JobRunStore {
  return {
    async claim(name, runKey) {
      try {
        const row = await client.jobRun.create({ data: { name, runKey } })
        return row.id
      } catch (error) {
        if (isUniqueViolation(error)) return null
        throw error
      }
    },
    async finish(id, outcome) {
      await client.jobRun.update({
        where: { id },
        data: { finishedAt: new Date(), outcome },
      })
    },
  }
}
