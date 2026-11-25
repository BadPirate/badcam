"use client"

import { useActionState } from "react"
import { CopyableValue } from "@kaperkunde/ui/copy-button"
import { FormError } from "@kaperkunde/ui/form-status"
import { Field } from "@kaperkunde/ui/label"
import { Input } from "@kaperkunde/ui/input"
import { SubmitButton } from "@kaperkunde/ui/submit-button"

import { addDevice, type AddDeviceState } from "@/app/(app)/settings/actions"

export function AddDeviceForm() {
  const [state, action] = useActionState<AddDeviceState, FormData>(addDevice, {
    error: null,
    token: null,
    name: null,
  })
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field
        label="Device name"
        htmlFor="device-name"
        hint="For example the car's name."
      >
        <Input id="device-name" name="name" required maxLength={64} />
      </Field>
      <FormError error={state.error} />
      {state.token ? (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-card border border-border p-3"
        >
          <p className="text-sm">
            Token for {state.name}. It is shown once; copy it into the device
            config now.
          </p>
          <CopyableValue value={state.token} />
        </div>
      ) : null}
      <SubmitButton pendingText="Adding…" size="lg">
        Add device
      </SubmitButton>
    </form>
  )
}
