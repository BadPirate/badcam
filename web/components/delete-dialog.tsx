"use client"

import { Button } from "@kaperkunde/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@kaperkunde/ui/dialog"
import { SubmitButton } from "@kaperkunde/ui/submit-button"

export function DeleteDialog({ action }: { action: () => Promise<void> }) {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="destructive-soft" size="lg" />}>
        Delete
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Delete this event?</DialogTitle>
        <DialogDescription>
          The video and every original clip are removed from the server. This
          cannot be undone.
        </DialogDescription>
        <form action={action}>
          <DialogFooter>
            <DialogClose
              render={<Button variant="secondary" size="lg" type="button" />}
            >
              Cancel
            </DialogClose>
            <SubmitButton
              variant="destructive-soft"
              size="lg"
              pendingText="Deleting…"
            >
              Delete
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
