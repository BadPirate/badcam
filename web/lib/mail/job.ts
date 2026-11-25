import { notifyDeps } from "./deps"
import {
  retryUnsent,
  runDailySummary,
  runDeviceAlerts,
  type NotifyDeps,
} from "./notify"

export async function runNotifications(
  now: Date = new Date(),
  deps: NotifyDeps = { ...notifyDeps, now: () => now },
): Promise<string> {
  const parts: string[] = []
  for (const [name, step] of [
    ["retried", () => retryUnsent(deps)],
    ["summary", () => runDailySummary(deps)],
    ["alerts", () => runDeviceAlerts(deps)],
  ] as const) {
    try {
      parts.push(`${name} ${await step()}`)
    } catch (error) {
      deps.log(
        `${name} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      parts.push(`${name} failed`)
    }
  }
  return parts.join(", ")
}
