import { notFound } from "next/navigation"
import { Badge } from "@kaperkunde/ui/badge"
import { Button } from "@kaperkunde/ui/button"
import { PageColumn, PageHeader } from "@kaperkunde/ui/page"

import { AutoRefresh } from "@/components/auto-refresh"
import { DeleteDialog } from "@/components/delete-dialog"
import { TriggerButton } from "@/components/trigger-button"
import { db } from "@/lib/db"
import { formatBytes } from "@/lib/storage/disk"
import { formatCarTime, formatDuration, prettyReason } from "@/lib/format"
import { removeEvent, restitch, toggleStar } from "../actions"

export const dynamic = "force-dynamic"

export default async function EventPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const event = await db.event.findUnique({
    where: { id },
    include: { clips: { orderBy: { path: "asc" } } },
  })
  if (!event || event.deletedAt) notFound()
  if (!event.viewedAt)
    await db.event.update({ where: { id }, data: { viewedAt: new Date() } })

  const ready = event.stitchStatus === "DONE"
  const waiting =
    event.stitchStatus !== "DONE" && event.stitchStatus !== "FAILED"
  const triggerOffset = event.triggerAt
    ? Math.round((event.triggerAt.getTime() - event.startedAt.getTime()) / 1000)
    : null
  const originals = event.clips.filter(
    (c) => !c.fileDeleted && c.path.endsWith(".mp4"),
  )
  const bind = (fn: (id: string) => Promise<void>) => fn.bind(null, id)

  return (
    <PageColumn width="narrow">
      <PageHeader
        back={{ href: "/", label: "Events" }}
        title={`${formatCarTime(event.startedAt)}`}
        description={[
          event.city,
          prettyReason(event.reason),
          formatDuration(event.durationSec),
        ]
          .filter(Boolean)
          .join(" · ")}
      />
      {waiting ? <AutoRefresh /> : null}

      {ready ? (
        <video
          id="event-video"
          className="w-full rounded-card bg-black"
          controls
          playsInline
          preload="metadata"
          poster={event.hasPoster ? `/media/${id}/poster.jpg` : undefined}
          src={`/media/${id}/event.mp4`}
        />
      ) : event.stitchStatus === "FAILED" ? (
        <p
          role="alert"
          className="rounded-card border border-destructive/40 p-4 text-destructive"
        >
          Stitching failed: {event.stitchError?.slice(0, 300)}
        </p>
      ) : (
        <p
          role="status"
          className="rounded-card border border-border p-4 text-muted-foreground"
        >
          This event is still being processed. The page refreshes by itself.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={event.kind === "SENTRY" ? "warning" : "default"}>
          {event.kind.toLowerCase()}
        </Badge>
        {ready && triggerOffset !== null ? (
          <TriggerButton seconds={triggerOffset} />
        ) : null}
        {event.lat !== null && event.lon !== null ? (
          <Button
            variant="outline"
            size="lg"
            render={
              <a
                href={`https://www.google.com/maps?q=${event.lat},${event.lon}`}
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            Map
          </Button>
        ) : null}
        <form action={bind(toggleStar)}>
          <Button
            type="submit"
            variant={event.starred ? "default" : "secondary"}
            size="lg"
          >
            {event.starred ? "Unstar" : "Star"}
          </Button>
        </form>
        {!event.originalsDeletedAt && event.stitchStatus !== "RUNNING" ? (
          <form action={bind(restitch)}>
            <Button type="submit" variant="secondary" size="lg">
              Re-stitch
            </Button>
          </form>
        ) : null}
        <DeleteDialog action={bind(removeEvent)} />
      </div>

      {ready ? (
        <p className="text-sm text-muted-foreground">
          Stitched {formatBytes(Number(event.stitchedBytes))}
          {event.hasHighlight ? (
            <>
              {" · "}
              <a
                className="text-primary underline"
                href={`/media/${id}/highlight.mp4`}
              >
                motion highlight
              </a>
            </>
          ) : null}
        </p>
      ) : null}

      {originals.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Original clips
          </h2>
          <ul className="flex flex-col">
            {originals.map((c) => {
              const name = c.path.split("/").at(-1) as string
              return (
                <li key={c.id}>
                  <a
                    className="inline-flex min-h-11 items-center text-primary underline"
                    href={`/media/${id}/orig/${encodeURIComponent(name)}`}
                    download
                  >
                    {name} ({formatBytes(c.size)})
                  </a>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}
    </PageColumn>
  )
}
