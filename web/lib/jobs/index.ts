import cron from "node-cron"
import {
  dailyRunKey,
  hourlyRunKey,
  startScheduler,
  type Job,
} from "@kaperkunde/next-kit/scheduler"

import { db } from "../db"
import { runDiskGuard, runRetention } from "../retention/run"
import { drain, isDraining } from "../stitch/queue"
import { createJobRunStore } from "./store"

const THIRTY_MIN = 30 * 60_000

export async function stitchSweep(now: Date = new Date()): Promise<string> {
  const idle = new Date(now.getTime() - THIRTY_MIN)
  const completed = await db.event.updateMany({
    where: {
      deletedAt: null,
      uploadComplete: false,
      lastUploadAt: { lt: idle },
    },
    data: { uploadComplete: true },
  })
  const queued = await db.event.updateMany({
    where: { deletedAt: null, uploadComplete: true, stitchStatus: "PENDING" },
    data: { stitchStatus: "QUEUED" },
  })
  // Only this process stitches, so RUNNING without an active drain is stuck.
  const reset = isDraining()
    ? { count: 0 }
    : await db.event.updateMany({
        where: { stitchStatus: "RUNNING" },
        data: { stitchStatus: "QUEUED" },
      })
  const stitched = await drain()
  return `completed ${completed.count}, queued ${queued.count}, reset ${reset.count}, stitched ${stitched}`
}

export const jobs: Job[] = [
  {
    name: "stitch-sweep",
    cron: "*/5 * * * *",
    runKey: (now) => now.toISOString().slice(0, 16),
    run: stitchSweep,
  },
  {
    name: "retention",
    cron: "17 3 * * *",
    timezone: "Europe/Amsterdam",
    runKey: dailyRunKey,
    run: runRetention,
  },
  {
    name: "disk-guard",
    cron: "7 * * * *",
    runKey: hourlyRunKey,
    run: () => runDiskGuard(),
  },
]

export function startJobs(): void {
  startScheduler(jobs, createJobRunStore(), cron)
}
