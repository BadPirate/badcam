import { runBootChecks, secretProblem } from "@kaperkunde/security"
import { getMigrationProblem } from "@kaperkunde/next-kit/prisma"

import { db } from "./db"
import { getEnv } from "./env"
import { startJobs } from "./jobs"
import { dataDirProblem, emptyTmp } from "./storage/disk"

export async function boot(): Promise<void> {
  const env = getEnv()
  await runBootChecks([
    () => secretProblem("SESSION_SECRET", env.sessionSecret),
    () => secretProblem("OWNER_PASSWORD", env.ownerPassword, { minLength: 12 }),
    () => getMigrationProblem(db),
    () => dataDirProblem(),
  ])
  await emptyTmp()
  startJobs()
}
