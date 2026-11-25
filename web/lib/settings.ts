import { isUniqueViolation } from "@kaperkunde/next-kit/prisma"

import { db } from "./db"
import { getEnv } from "./env"
import type { Settings } from "./settings-fields"

const ID = "singleton"

function seed(): Settings {
  const env = getEnv()
  return {
    retainSentryDays: env.retainSentryDays,
    retainSavedDays: env.retainSavedDays,
    retainRecentDays: env.retainRecentDays,
    retainOriginalsDays: env.retainOriginalsDays,
    minFreeGb: env.minFreeGb,
  }
}

/** The stored values; the first read seeds the row from the environment. */
export async function getSettings(): Promise<Settings> {
  const pick = (r: Settings & object): Settings => ({
    retainSentryDays: r.retainSentryDays,
    retainSavedDays: r.retainSavedDays,
    retainRecentDays: r.retainRecentDays,
    retainOriginalsDays: r.retainOriginalsDays,
    minFreeGb: r.minFreeGb,
  })
  const row = await db.setting.findUnique({ where: { id: ID } })
  if (row) return pick(row)
  try {
    return pick(await db.setting.create({ data: { id: ID, ...seed() } }))
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    return pick(await db.setting.findUniqueOrThrow({ where: { id: ID } }))
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await db.setting.upsert({
    where: { id: ID },
    create: { id: ID, ...settings },
    update: settings,
  })
}

export type { Settings } from "./settings-fields"
