"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { requireOwner } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { deleteEvent } from "@/lib/retention/run"
import { drain, resetStitched } from "@/lib/stitch/queue"

export async function toggleStar(eventId: string): Promise<void> {
  await requireOwner()
  const e = await db.event.findUnique({ where: { id: eventId } })
  if (!e || e.deletedAt) return
  await db.event.update({
    where: { id: eventId },
    data: { starred: !e.starred },
  })
  revalidatePath(`/events/${eventId}`)
}

export async function removeEvent(eventId: string): Promise<void> {
  await requireOwner()
  const e = await db.event.findUnique({ where: { id: eventId } })
  if (e && !e.deletedAt) await deleteEvent(e)
  redirect("/")
}

export async function restitch(eventId: string): Promise<void> {
  await requireOwner()
  const e = await db.event.findUnique({ where: { id: eventId } })
  if (!e || e.deletedAt || e.originalsDeletedAt) return
  if (e.stitchStatus === "RUNNING") return
  await resetStitched(eventId)
  await db.event.update({
    where: { id: eventId },
    data: {
      stitchStatus: "QUEUED",
      uploadComplete: true,
      stitchError: null,
      hasPoster: false,
      hasHighlight: false,
    },
  })
  void drain()
  revalidatePath(`/events/${eventId}`)
}
