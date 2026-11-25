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
import { retentionPreview } from "@/lib/retention/run"
import { getSettings } from "@/lib/settings"
import {
  NotificationsForm,
  SmtpForm,
  TestEmailForm,
} from "@/components/mail-forms"
import { loadMailContext } from "@/lib/mail/store"
import { RetentionForm } from "@/components/retention-form"
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
  const [devices, runs, disk, totals, settings, preview, mail] =
    await Promise.all([
      db.device.findMany({ orderBy: { createdAt: "asc" } }),
      db.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 20 }),
      diskUsage().catch(() => null),
      db.event.aggregate({
        where: { deletedAt: null },
        _count: true,
        _sum: { originalsBytes: true, stitchedBytes: true },
      }),
      getSettings(),
      retentionPreview(),
      loadMailContext(),
    ])

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

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Retention</h2>
        <p className="text-sm text-muted-foreground">
          Starred events are never removed. The nightly job at 03:17 applies
          these values; the environment only seeds them the first time.
        </p>
        <RetentionForm values={settings} />
        <div className="rounded-card border border-border p-3 text-sm">
          <p className="font-semibold">Next prune</p>
          {preview.next.length === 0 ? (
            <p className="text-muted-foreground">Nothing is due.</p>
          ) : (
            <>
              <p className="text-muted-foreground">
                {preview.deleteEvents} events and {preview.deleteOriginals} sets
                of originals are due at the next run.
              </p>
              <ul>
                {preview.next.map((n) => (
                  <li key={n.id}>
                    {formatCarTime(n.startedAt)} {n.kind.toLowerCase()}:{" "}
                    {n.action === "delete-event"
                      ? "delete event"
                      : "delete originals"}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Email</h2>
        <p className="text-sm text-muted-foreground">
          {mail.mode === "configured"
            ? "Mail is configured."
            : mail.mode === "dev-fallback"
              ? "No SMTP host is set; in development mail goes to localhost:1025 (Mailpit)."
              : "Not configured: no SMTP host is set, so no mail is sent. Set SMTP_HOST in the environment or fill in the host below."}
          {mail.publicUrl
            ? ""
            : " PUBLIC_URL is not set, so mails carry no links."}
        </p>
        <SmtpForm
          smtp={mail.smtp.view}
          keyConfigured={mail.smtp.keyConfigured}
          recipients={mail.recipients.join(", ")}
          recipientSource={mail.recipientSource}
        />
        <TestEmailForm />
        <h3 className="font-semibold">Notifications</h3>
        <NotificationsForm prefs={mail.prefs} />
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
