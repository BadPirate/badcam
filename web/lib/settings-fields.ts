// Pure parts of the retention settings, safe to import from client components.

export type Settings = {
  retainSentryDays: number
  retainSavedDays: number
  retainRecentDays: number
  retainOriginalsDays: number
  minFreeGb: number
}

export const SETTING_FIELDS = [
  {
    key: "retainSentryDays",
    label: "Sentry events (days)",
    hint: "Delete a Sentry event this many days after it started. 0 keeps them forever.",
  },
  {
    key: "retainSavedDays",
    label: "Saved events (days)",
    hint: "Delete a saved event after this many days. 0 keeps them forever.",
  },
  {
    key: "retainRecentDays",
    label: "Recent clips (days)",
    hint: "Delete rolling recent clips after this many days. 0 keeps them forever.",
  },
  {
    key: "retainOriginalsDays",
    label: "Original clips after stitching (days)",
    hint: "Delete the full-size originals this many days after a successful stitch, keeping the stitched video. 0 keeps them.",
  },
  {
    key: "minFreeGb",
    label: "Free-space floor (GB)",
    hint: "Below this the disk guard frees space, oldest unstarred first. 0 turns the guard off.",
  },
] as const satisfies readonly {
  key: keyof Settings
  label: string
  hint: string
}[]

const MAX = 100_000

/** Integers from 0 to 100000, as text from a form. */
export function parseSettings(
  input: Record<string, unknown>,
):
  | { ok: true; settings: Settings }
  | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const out: Record<string, number> = {}
  for (const f of SETTING_FIELDS) {
    const raw = String(input[f.key] ?? "").trim()
    if (!/^\d{1,6}$/.test(raw) || Number(raw) > MAX) {
      errors[f.key] = `Enter a whole number from 0 to ${MAX}.`
      continue
    }
    out[f.key] = Number(raw)
  }
  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, settings: out as Settings }
}
