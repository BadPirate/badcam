"use client"

import { useActionState } from "react"
import { FormError, FormNote } from "@kaperkunde/ui/form-status"
import { Checkbox, Input, Select, Textarea } from "@kaperkunde/ui/input"
import { Field } from "@kaperkunde/ui/label"
import { SubmitButton } from "@kaperkunde/ui/submit-button"
import { SwitchRow } from "@kaperkunde/ui/switch"

import {
  sendTestEmail,
  updateMailSettings,
  updateNotifications,
  type MailState,
} from "@/app/(app)/settings/actions"
import type { EffectiveSmtp } from "@/lib/mail/config"
import type { NotifyPrefs } from "@/lib/mail/prefs"

const EMPTY: MailState = { errors: {}, message: null }

const sourceNote = (source: string) =>
  source === "custom"
    ? "custom value"
    : source === "env"
      ? "from the environment"
      : "not set"

const PASSWORD_TEXT = {
  env: "set (from env)",
  custom: "set (custom)",
  unset: "not set",
  unreadable: "set, but unreadable: the secret key changed. Enter it again.",
} as const

export function SmtpForm({
  smtp,
  keyConfigured,
  recipients,
  recipientSource,
}: {
  smtp: EffectiveSmtp["view"]
  keyConfigured: boolean
  recipients: string
  recipientSource: string
}) {
  const [state, action] = useActionState<MailState, FormData>(
    updateMailSettings,
    EMPTY,
  )
  const field = (
    key: "host" | "port" | "user" | "from" | "replyTo",
    name: string,
    label: string,
    custom: string,
    placeholder?: string,
  ) => (
    <Field
      label={label}
      htmlFor={name}
      hint={`Currently ${sourceNote(smtp.sources[key])}. Empty uses the environment value.`}
      error={state.errors[name]}
    >
      <Input
        id={name}
        name={name}
        defaultValue={custom}
        placeholder={placeholder}
        autoComplete="off"
      />
    </Field>
  )
  return (
    <form action={action} className="flex flex-col gap-4">
      {field(
        "host",
        "smtpHost",
        "SMTP host",
        smtp.sources.host === "custom" ? smtp.host : "",
        smtp.sources.host === "env" ? smtp.host : "smtp.example.com",
      )}
      {field(
        "port",
        "smtpPort",
        "Port",
        smtp.sources.port === "custom" ? smtp.port : "",
        smtp.sources.port === "env" ? smtp.port : "587",
      )}
      <Field
        label="Encryption"
        htmlFor="smtpSecure"
        hint={`Currently ${sourceNote(smtp.sources.secure)}. Default: implicit TLS on port 465, otherwise STARTTLS.`}
        error={state.errors.smtpSecure}
      >
        <Select
          id="smtpSecure"
          name="smtpSecure"
          defaultValue={smtp.sources.secure === "custom" ? smtp.secure : ""}
        >
          <option value="">Use the environment value</option>
          <option value="true">Implicit TLS (port 465)</option>
          <option value="false">STARTTLS or none</option>
        </Select>
      </Field>
      {field(
        "user",
        "smtpUser",
        "User",
        smtp.sources.user === "custom" ? smtp.user : "",
      )}
      <Field
        label="Password"
        htmlFor="smtpPassword"
        hint={
          keyConfigured
            ? `Status: ${PASSWORD_TEXT[smtp.password]}. Never shown; leave empty to keep it.`
            : `Status: ${PASSWORD_TEXT[smtp.password]}. Storing a password here is disabled: set SETTINGS_SECRET_KEY (openssl rand -base64 32).`
        }
        error={state.errors.smtpPassword}
      >
        <Input
          id="smtpPassword"
          name="smtpPassword"
          type="password"
          autoComplete="new-password"
          disabled={!keyConfigured}
        />
      </Field>
      {smtp.password === "custom" || smtp.password === "unreadable" ? (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox name="clearSmtpPassword" />
          Remove the custom password and use the environment value
        </label>
      ) : null}
      {field(
        "from",
        "smtpFrom",
        "From",
        smtp.sources.from === "custom" ? smtp.from : "",
        smtp.sources.from === "env" ? smtp.from : "Badcam <badcam@example.com>",
      )}
      {field(
        "replyTo",
        "smtpReplyTo",
        "Reply-to",
        smtp.sources.replyTo === "custom" ? smtp.replyTo : "",
        smtp.sources.replyTo === "env" ? smtp.replyTo : "",
      )}
      <Field
        label="Recipients"
        htmlFor="recipients"
        hint={`One or more addresses, separated by commas or lines. Currently ${sourceNote(recipientSource)} (NOTIFY_TO when empty).`}
        error={state.errors.recipients}
      >
        <Textarea
          id="recipients"
          name="recipients"
          rows={2}
          defaultValue={recipientSource === "custom" ? recipients : ""}
          placeholder={
            recipientSource === "env" ? recipients : "owner@example.com"
          }
        />
      </Field>
      <FormNote message={state.message} />
      <SubmitButton size="lg" pendingText="Saving…">
        Save email settings
      </SubmitButton>
    </form>
  )
}

export function TestEmailForm() {
  const [state, action] = useActionState<MailState, FormData>(
    () => sendTestEmail(),
    EMPTY,
  )
  return (
    <form action={action} className="flex flex-col gap-2">
      <FormError error={state.errors.test} />
      <FormNote message={state.message} />
      <SubmitButton size="lg" variant="outline" pendingText="Sending…">
        Send test email
      </SubmitButton>
    </form>
  )
}

export function NotificationsForm({ prefs }: { prefs: NotifyPrefs }) {
  const [state, action] = useActionState<MailState, FormData>(
    updateNotifications,
    EMPTY,
  )
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="rounded-card border border-border">
        <SwitchRow
          id="notifySentry"
          name="notifySentry"
          label="Sentry event ready"
          description="One mail per event, when it has finished stitching."
          defaultChecked={prefs.notifySentry}
        />
        <SwitchRow
          id="notifySaved"
          name="notifySaved"
          label="Saved clip ready"
          description="The same for saved clips."
          defaultChecked={prefs.notifySaved}
        />
        <SwitchRow
          id="notifyDaily"
          name="notifyDaily"
          label="Daily summary"
          description="New events, storage and the device's last status."
          defaultChecked={prefs.notifyDaily}
        />
        <SwitchRow
          id="dailySkipEmpty"
          name="dailySkipEmpty"
          label="Skip the summary when nothing happened"
          defaultChecked={prefs.dailySkipEmpty}
        />
        <SwitchRow
          id="notifyAlerts"
          name="notifyAlerts"
          label="Device alerts"
          description="One mail per problem, until it clears."
          defaultChecked={prefs.notifyAlerts}
        />
      </div>
      <Field
        label="Summary time (Europe/Amsterdam)"
        htmlFor="dailyTime"
        hint="24-hour clock, for example 08:00."
        error={state.errors.dailyTime}
      >
        <Input
          id="dailyTime"
          name="dailyTime"
          defaultValue={prefs.dailyTime}
          placeholder="08:00"
          required
        />
      </Field>
      <Field
        label="Alert: battery below (V)"
        htmlFor="alertBatteryV"
        error={state.errors.alertBatteryV}
      >
        <Input
          id="alertBatteryV"
          name="alertBatteryV"
          type="number"
          step="0.01"
          min="0"
          defaultValue={prefs.alertBatteryV}
          required
        />
      </Field>
      <Field
        label="Alert: card free below (GB)"
        htmlFor="alertCardGb"
        error={state.errors.alertCardGb}
      >
        <Input
          id="alertCardGb"
          name="alertCardGb"
          type="number"
          step="1"
          min="0"
          defaultValue={prefs.alertCardGb}
          required
        />
      </Field>
      <Field
        label="Alert: not seen for (hours)"
        htmlFor="alertOfflineHours"
        hint="A car that is parked and asleep goes quiet; pick a long time."
        error={state.errors.alertOfflineHours}
      >
        <Input
          id="alertOfflineHours"
          name="alertOfflineHours"
          type="number"
          step="1"
          min="1"
          defaultValue={prefs.alertOfflineHours}
          required
        />
      </Field>
      <FormNote message={state.message} />
      <SubmitButton size="lg" pendingText="Saving…">
        Save notifications
      </SubmitButton>
    </form>
  )
}
