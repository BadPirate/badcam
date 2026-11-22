"use client"

import { useActionState } from "react"
import { FormNote } from "@kaperkunde/ui/form-status"
import { Input } from "@kaperkunde/ui/input"
import { Field } from "@kaperkunde/ui/label"
import { SubmitButton } from "@kaperkunde/ui/submit-button"

import {
  updateSettings,
  type SettingsState,
} from "@/app/(app)/settings/actions"
import { SETTING_FIELDS, type Settings } from "@/lib/settings-fields"

export function RetentionForm({ values }: { values: Settings }) {
  const [state, action] = useActionState<SettingsState, FormData>(
    updateSettings,
    { errors: {}, saved: false },
  )
  return (
    <form action={action} className="flex flex-col gap-4">
      {SETTING_FIELDS.map((f) => (
        <Field
          key={f.key}
          label={f.label}
          htmlFor={f.key}
          hint={f.hint}
          error={state.errors[f.key]}
        >
          <Input
            id={f.key}
            name={f.key}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            defaultValue={values[f.key]}
            required
          />
        </Field>
      ))}
      <FormNote message={state.saved ? "Saved." : null} />
      <SubmitButton size="lg" pendingText="Saving…">
        Save retention
      </SubmitButton>
    </form>
  )
}
