import { useRef } from 'react'
import { AlertCircle, ChevronRight, RotateCcw } from 'lucide-react'

import { CheckboxField } from '@/components/jobs/JobFormControls'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

const TEMPLATE_KINDS = [
  { key: 'quote', label: 'Quotes' },
  { key: 'invoice', label: 'Invoices' },
  { key: 'payment_reminder', label: 'Payment reminder, to the customer' },
  { key: 'report', label: 'Inspection reports' },
  { key: 'job_assigned', label: 'New job, to the technician' },
]

function Field({ label, htmlFor, hint, className, children }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/**
 * One template, in a card that opens.
 *
 * A plain <details>: the browser already does disclosure, including the
 * keyboard and the accessibility tree, so there is no open state to hold, no
 * aria-expanded to keep in step, and nothing to reset when the form reloads.
 * The only cost is hiding the default triangle.
 *
 * The buttons live in the body rather than the summary - a button inside a
 * <summary> toggles the card as well as doing its own job.
 */
function TemplateEditor({ kind, label, template, fallback, placeholders, onChange }) {
  const bodyRef = useRef(null)
  const edited =
    Boolean(fallback) &&
    (template.subject !== fallback.subject || template.body !== fallback.body)

  function insert(placeholder) {
    const token = `{${placeholder}}`
    const textarea = bodyRef.current
    const body = template.body ?? ''
    const start = textarea?.selectionStart ?? body.length
    const end = textarea?.selectionEnd ?? body.length
    onChange({ ...template, body: body.slice(0, start) + token + body.slice(end) })
    requestAnimationFrame(() => {
      textarea?.focus()
      textarea?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  return (
    <details className="group rounded-lg border border-border bg-card transition-colors open:bg-muted/20">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <span className="shrink-0 text-sm font-semibold text-foreground">{label}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground group-open:invisible">
          {template.subject}
        </span>
        {edited ? (
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
            Edited
          </span>
        ) : null}
      </summary>

      <div className="space-y-3 border-t border-border px-4 pb-4 pt-4">
        <Field label="Subject" htmlFor={`template-${kind}-subject`}>
          <Input
            id={`template-${kind}-subject`}
            value={template.subject}
            onChange={(event) => onChange({ ...template, subject: event.target.value })}
          />
        </Field>
        <Field label="Message" htmlFor={`template-${kind}-body`}>
          <Textarea
            id={`template-${kind}-body`}
            ref={bodyRef}
            rows={8}
            value={template.body}
            onChange={(event) => onChange({ ...template, body: event.target.value })}
          />
        </Field>
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Tap to add to the message:</p>
          <div className="flex flex-wrap gap-1.5">
            {placeholders.map((placeholder) => (
              <button
                key={placeholder}
                type="button"
                onClick={() => insert(placeholder)}
                className="rounded border border-input bg-card px-2 py-0.5 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted"
              >
                {`{${placeholder}}`}
              </button>
            ))}
          </div>
        </div>
      {edited ? (
        <div className="flex justify-end pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ ...fallback })}>
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to default
          </Button>
        </div>
      ) : null}
      </div>
    </details>
  )
}

/**
 * What this client controls about its own email.
 *
 * How mail is actually sent - the provider, server and credentials - is PestBase's
 * setting, shared by every client and configured under Platform > Settings. One
 * mail account, one place to fix it when it breaks.
 *
 * What stays here is what this client's own customers see and act on: where
 * their replies land, who gets a copy, and the wording. A shared reply-to would
 * send one client's customers to another client's inbox.
 */
export function EmailSettings({ form, set, settings, saving, dirty, onSave, SaveBar }) {
  const placeholders = settings?.email_placeholders ?? { common: [] }
  const defaults = settings?.default_email_templates ?? {}
  const templates = form.email_templates ?? defaults
  const canSend = Boolean(settings?.email_configured)

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Your email</CardTitle>
          <CardDescription>
            PestBase sends your quotes, invoices and reports for you. These decide what your customers
            see when one arrives.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {canSend ? null : (
            <div
              role="status"
              className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                PestBase has not set up email sending yet, so nothing can go out. Anything you save here
                is kept and used as soon as it is.
              </span>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Replies go to"
              htmlFor="email_reply_to"
              hint="Optional. Where a customer's reply lands."
            >
              <Input
                id="email_reply_to"
                type="email"
                value={form.email_reply_to}
                onChange={(event) => set('email_reply_to', event.target.value)}
                placeholder="accounts@yourcompany.co.uk"
              />
            </Field>
            <Field
              label="Send a copy of every email to"
              htmlFor="email_bcc"
              hint="Optional, e.g. the office, so there's a record."
            >
              <Input
                id="email_bcc"
                type="email"
                value={form.email_bcc}
                onChange={(event) => set('email_bcc', event.target.value)}
                placeholder="info@yourcompany.co.uk"
              />
            </Field>
          </div>

          <CheckboxField
            id="email_technicians"
            checked={form.email_technicians !== false}
            onChange={(checked) => set('email_technicians', checked)}
            label="Email technicians when they're given a job"
            description="With the date, address, site contact and a link to the job. One email covers a whole repeating series."
          />

          <div className="space-y-3">
            <CheckboxField
              id="email_payment_reminders"
              checked={form.email_payment_reminders === true}
              onChange={(checked) => set('email_payment_reminders', checked)}
              label="Remind customers before an invoice falls due"
              description="One email per invoice, sent once, and only while it is still unpaid. Nothing is attached. Edit the wording under Payment reminder below."
            />
            {form.email_payment_reminders === true ? (
              <div className="ml-8 max-w-[15rem]">
                <Field
                  label="Days before the due date"
                  htmlFor="payment_reminder_days"
                  hint="Between 1 and 30. An invoice already overdue is never sent one."
                >
                  <Input
                    id="payment_reminder_days"
                    type="number"
                    min={1}
                    max={30}
                    value={form.payment_reminder_days ?? 3}
                    onChange={(event) => set('payment_reminder_days', event.target.value)}
                  />
                </Field>
              </div>
            ) : null}
          </div>

          <SaveBar saving={saving} dirty={dirty} onSave={() => void onSave()} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Email templates</CardTitle>
          <CardDescription>
            The subject and message each document is sent with. Words in braces, like{' '}
            <span className="font-mono">{'{customer_name}'}</span>, are filled in when you send, and
            you can still change the email before it goes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {TEMPLATE_KINDS.map(({ key, label }) =>
            templates?.[key] ? (
              <TemplateEditor
                key={key}
                kind={key}
                label={label}
                template={templates[key]}
                fallback={defaults[key] ?? templates[key]}
                placeholders={[...(placeholders.common ?? []), ...(placeholders[key] ?? [])]}
                onChange={(next) => set('email_templates', { ...templates, [key]: next })}
              />
            ) : null,
          )}
          <div className="pt-3">
            <SaveBar saving={saving} dirty={dirty} onSave={() => void onSave()} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default EmailSettings
