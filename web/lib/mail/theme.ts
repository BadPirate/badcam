import type { EmailTheme } from "@kaperkunde/mail/template"

/** The look of badcam mail; `siteUrl` must be absolute. */
export function mailTheme(publicUrl: string): EmailTheme {
  return {
    name: "Badcam",
    siteUrl: publicUrl || "http://localhost:3100",
    colors: {
      page: "#f4f4f5",
      card: "#ffffff",
      border: "#e4e4e7",
      heading: "#18181b",
      text: "#3f3f46",
      muted: "#71717a",
      primary: "#18181b",
      onPrimary: "#ffffff",
    },
  }
}
