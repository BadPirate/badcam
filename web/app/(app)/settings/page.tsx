import { Badge } from "@kaperkunde/ui/badge"
import { Button } from "@kaperkunde/ui/button"
import { PageColumn, PageHeader } from "@kaperkunde/ui/page"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@kaperkunde/ui/table"

import { AddDeviceForm } from "@/components/add-device-form"
import { db } from "@/lib/db"
import { getEnv } from "@/lib/env"
import { formatCarTime } from "@/lib/format"
import { diskUsage, formatBytes } from "@/lib/storage/disk"
import { revokeDevice } from "./actions"

export const dynamic = "force-dynamic"

type Status = {
  state?: string
  battery_v?: number
  vin_v?: number
  free_bytes?: number
  car_power?: boolean
  version?: string
}

function parseStatus(text: string | null): Status {
  try {
    return text ? (JSON.parse(text) as Status) : {}
  } catch {
    return {}
  }
}

export default async function SettingsPage() {
  const env = getEnv()
  const [devices, runs, disk, totals] = await Promise.all([
    db.device.findMany({ orderBy: { createdAt: "asc" } }),
    db.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 20 }),
    diskUsage().catch(() => null),
    db.event.aggregate({
      where: { deletedAt: null },
      _count: true,
      _sum: { originalsBytes: true, stitchedBytes: true },
    }),
  ])
  const zeroOff = (n: number) => (n === 0 ? "kept" : `${n} days`)

  return (
    <PageColumn width="narrow">
      <PageHeader title="Settings" />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Devices</h2>
        {devices.length === 0 ? (
          <p className="text-muted-foreground">No devices yet.</p>
        ) : null}
        <ul className="flex flex-col gap-3">
          {devices.map((d) => {
            const s = parseStatus(d.lastStatus)
            return (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-3 rounded-card border border-border bg-card p-3"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{d.name}</span>
                    {d.revokedAt ? (
                      <Badge variant="destructive">revoked</Badge>
                    ) : null}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {d.lastSeenAt
                      ? `seen ${formatCarTime(d.lastSeenAt)} UTC`
                      : "never seen"}
                    {s.state ? ` · ${s.state}` : ""}
                    {typeof s.battery_v === "number"
                      ? ` · battery ${s.battery_v} V`
                      : ""}
                    {typeof s.free_bytes === "number"
                      ? ` · ${formatBytes(s.free_bytes)} free`
                      : ""}
                  </div>
                </div>
                {d.revokedAt ? null : (
                  <form action={revokeDevice.bind(null, d.id)}>
                    <Button type="submit" variant="destructive-soft" size="lg">
                      Revoke
                    </Button>
                  </form>
                )}
              </li>
            )
          })}
        </ul>
        <AddDeviceForm />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Retention</h2>
        <p className="text-sm text-muted-foreground">
          Starred events are never removed. Set in the environment.
        </p>
        <ul className="text-sm">
          <li>Sentry events: {zeroOff(env.retainSentryDays)}</li>
          <li>Saved events: {zeroOff(env.retainSavedDays)}</li>
          <li>Recent clips: {zeroOff(env.retainRecentDays)}</li>
          <li>
            Original clips after stitching: {zeroOff(env.retainOriginalsDays)}
          </li>
          <li>Free-space floor: {env.minFreeGb} GB</li>
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Storage</h2>
        <ul className="text-sm">
          {disk ? (
            <li>
              Disk: {formatBytes(disk.usedBytes)} of{" "}
              {formatBytes(disk.totalBytes)} used, {formatBytes(disk.freeBytes)}{" "}
              free
            </li>
          ) : null}
          <li>{totals._count} events</li>
          <li>
            Originals: {formatBytes(Number(totals._sum.originalsBytes ?? 0))}
          </li>
          <li>
            Stitched: {formatBytes(Number(totals._sum.stitchedBytes ?? 0))}
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Recent job runs</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job</TableHead>
              <TableHead>Started (UTC)</TableHead>
              <TableHead>Outcome</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.name}</TableCell>
                <TableCell>{formatCarTime(r.startedAt)}</TableCell>
                <TableCell>
                  {r.outcome ?? (r.finishedAt ? "" : "running")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </PageColumn>
  )
}
