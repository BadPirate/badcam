import "./load-env"
// Usage: pnpm -s tsx --env-file=.env scripts/create-device.ts <name>
// Prints the bearer token (shown once) to stdout.
import { createDevice } from "../lib/auth/device"
import { db } from "../lib/db"

const name = process.argv[2]
if (!name) {
  console.error("usage: create-device.ts <name>")
  process.exit(2)
}
const { token } = await createDevice(name)
console.log(token)
await db.$disconnect()
