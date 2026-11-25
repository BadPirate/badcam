"use client"

import { useActionState } from "react"
import { FormError } from "@kaperkunde/ui/form-status"
import { Field } from "@kaperkunde/ui/label"
import { Input } from "@kaperkunde/ui/input"
import { SubmitButton } from "@kaperkunde/ui/submit-button"

import { login, type LoginState } from "@/app/login/actions"

export function LoginForm() {
  const [state, action] = useActionState<LoginState, FormData>(login, {
    error: null,
  })
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Password" htmlFor="password">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
        />
      </Field>
      <FormError error={state.error} />
      <SubmitButton pendingText="Checking…">Sign in</SubmitButton>
    </form>
  )
}
