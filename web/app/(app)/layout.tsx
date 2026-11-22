import Link from "next/link"
import { PageShell } from "@kaperkunde/ui/page"
import { Button } from "@kaperkunde/ui/button"

import { logout } from "@/app/login/actions"
import { requireOwner } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { formatCarTime } from "@/lib/format"
import { diskUsage, formatBytes } from "@/lib/storage/disk"

export const dynamic = "force-dynamic"

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireOwner()
  const [disk, seen] = await Promise.all([
    diskUsage().catch(() => null),
    db.device.findFirst({
      where: { revokedAt: null, lastSeenAt: { not: null } },
      orderBy: { lastSeenAt: "desc" },
    }),
  ])
  const header = (
    <header className="border-b border-border">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-gutter py-3">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center text-lg font-bold text-primary"
        >
          badcam
        </Link>
        <Link href="/" className="inline-flex min-h-11 items-center px-2">
          Events
        </Link>
        <Link
          href="/settings"
          className="inline-flex min-h-11 items-center px-2"
        >
          Settings
        </Link>
        <div className="ml-auto flex flex-wrap items-center gap-x-4 text-sm text-muted-foreground">
          {disk ? (
            <span>
              {formatBytes(disk.usedBytes)} of {formatBytes(disk.totalBytes)}{" "}
              used
            </span>
          ) : null}
          {seen?.lastSeenAt ? (
            <span>
              {seen.name} seen {formatCarTime(seen.lastSeenAt)} UTC
            </span>
          ) : (
            <span>no device seen yet</span>
          )}
          <form action={logout}>
            <Button type="submit" variant="plain" size="lg">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </header>
  )
  return (
    <PageShell header={header} className="py-6">
      {children}
    </PageShell>
  )
}
