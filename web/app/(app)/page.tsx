import Link from "next/link"
import { Badge } from "@kaperkunde/ui/badge"
import { NavTabsList, NavTabsTrigger } from "@kaperkunde/ui/nav-tabs"
import { PageColumn } from "@kaperkunde/ui/page"

import { db } from "@/lib/db"
import type { Prisma } from "@/lib/generated/prisma/client"
import {
  formatCarClock,
  formatCarDay,
  formatDuration,
  prettyReason,
} from "@/lib/format"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 30
const TABS = [
  { key: "all", label: "All" },
  { key: "sentry", label: "Sentry" },
  { key: "saved", label: "Saved" },
  { key: "starred", label: "Starred" },
] as const

function filterFor(tab: string): Prisma.EventWhereInput {
  switch (tab) {
    case "sentry":
      return { kind: "SENTRY" }
    case "saved":
      return { kind: "SAVED" }
    case "starred":
      return { starred: true }
    default:
      return {}
  }
}

const STATUS_BADGE = {
  PENDING: { label: "waiting", variant: "secondary" },
  QUEUED: { label: "queued", variant: "secondary" },
  RUNNING: { label: "stitching", variant: "warning" },
  DONE: { label: "ready", variant: "default" },
  FAILED: { label: "failed", variant: "destructive" },
} as const

export default async function EventList({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string }>
}) {
  const sp = await searchParams
  const tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as string) : "all"
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1)
  const where: Prisma.EventWhereInput = { deletedAt: null, ...filterFor(tab) }
  const [total, events] = await Promise.all([
    db.event.count({ where }),
    db.event.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ])
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const days = new Map<string, typeof events>()
  for (const e of events) {
    const day = formatCarDay(e.startedAt)
    days.set(day, [...(days.get(day) ?? []), e])
  }
  const href = (t: string, p = 1) => `/?tab=${t}${p > 1 ? `&page=${p}` : ""}`

  return (
    <PageColumn>
      <NavTabsList label="Filter events">
        {TABS.map((t) => (
          <NavTabsTrigger key={t.key} href={href(t.key)} active={tab === t.key}>
            {t.label}
          </NavTabsTrigger>
        ))}
      </NavTabsList>

      {events.length === 0 ? (
        <p className="text-muted-foreground">No events yet.</p>
      ) : null}

      {[...days].map(([day, list]) => (
        <section key={day} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold tracking-wide text-muted-foreground">
            {day}
          </h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((e) => {
              const status = STATUS_BADGE[e.stitchStatus]
              return (
                <li key={e.id}>
                  <Link
                    href={`/events/${e.id}`}
                    className="flex min-h-11 flex-col overflow-hidden rounded-card border border-border bg-card focus-ring"
                  >
                    <div className="aspect-[4/3] bg-muted">
                      {e.hasPoster ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/media/${e.id}/poster.jpg`}
                          alt=""
                          className="size-full object-cover"
                          loading="lazy"
                        />
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-2 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {e.viewedAt ? null : (
                          <span
                            className="size-2 rounded-full bg-primary"
                            aria-label="not viewed"
                          />
                        )}
                        <span className="font-semibold">
                          {formatCarClock(e.startedAt)}
                        </span>
                        <Badge
                          variant={e.kind === "SENTRY" ? "warning" : "default"}
                        >
                          {e.kind.toLowerCase()}
                        </Badge>
                        <Badge variant={status.variant}>{status.label}</Badge>
                        {e.starred ? (
                          <Badge variant="solid">starred</Badge>
                        ) : null}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {[
                          e.city,
                          prettyReason(e.reason),
                          formatDuration(e.durationSec),
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </div>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {pages > 1 ? (
        <nav
          aria-label="Pages"
          className="flex items-center justify-between gap-3"
        >
          {page > 1 ? (
            <Link
              className="inline-flex min-h-11 items-center px-3 text-primary"
              href={href(tab, page - 1)}
            >
              Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-muted-foreground">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link
              className="inline-flex min-h-11 items-center px-3 text-primary"
              href={href(tab, page + 1)}
            >
              Older
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </PageColumn>
  )
}
