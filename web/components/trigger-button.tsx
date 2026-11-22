"use client"

import { Button } from "@kaperkunde/ui/button"

export function TriggerButton({ seconds }: { seconds: number }) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="lg"
      onClick={() => {
        const video = document.getElementById(
          "event-video",
        ) as HTMLVideoElement | null
        if (video) video.currentTime = Math.max(0, seconds)
      }}
    >
      Jump to trigger
    </Button>
  )
}
