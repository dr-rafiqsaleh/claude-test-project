import { useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, RotateCcw, Send } from 'lucide-react'

import { sendTestEmail } from '@/api/emails'
import { CheckboxField, ChoiceChips, SELECT_CLASSES } from '@/components/jobs/JobFormControls'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { toApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'

const PROVIDERS = ['none', 'microsoft365', 'smtp']

const PROVIDER_LABELS = {
  none: 'Not set up',
  microsoft365: 'Microsoft 365',
  smtp: 'Other provider (SMTP)',
}

const TEMPLATE_KINDS = [
  { key: 'quote', label: 'Quotes' },
  { key: 'invoice', label: 'Invoices' },
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

/** A write-only secret: shows whether one is saved, never what it is. */
function SecretField({ label, htmlFor, isSet, value, onChange, hint }) {
  return (
    <Field
      label={label}
      htmlFor={htmlFor}
      hint={isSet && !value ? 'Saved. Leave empty to keep it, or type a new one to replace it.' : hint}
    >
      <Input
        id={htmlFor}
        type="password"
        autoComplete="new-password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={isSet ? '••••••••  (saved)' : ''}
      />
    </Field>
  )
}

function MicrosoftGuide() {
  return (
    <details className="rounded-md border border-border bg-muted/40 p-4 text-sm">
      <summary className="cursor-pointer font-medium text-foreground">
        How to set up Microsoft 365 (about 10 minutes, needs a Microsoft 365 admin)
      </summary>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-muted-foreground">
        <li>
          Go to <span className="font-medium text-foreground">entra.microsoft.com</span>, then App
          registrations, then New registration. Call it QKil, keep &ldquo;this organisational
          directory only&rdquo;, and click Register.
        </li>
        <li>
          On its Overview page, copy the <span className="font-medium text-foreground">Application
          (client) ID</span> and the <span className="font-medium text-foreground">Directory
          (tenant) ID</span> into the boxes below.
        </li>
        <li>
          Open Certificates &amp; secrets, click New client secret, and copy its{' '}
          <span className="font-medium text-foreground">Value</span> (not its ID) into Client
          secret. Note when it expires: you&apos;ll need to make a new one before then.
        </li>
        <li>
          Open API permissions, click Add a permission, then Microsoft Graph, then Application
          permissions, tick <span className="font-medium text-foreground">Mail.Send</span>, and add
          it. Then click <span className="font-medium text-foreground">Grant admin consent</span>.
        </li>
        <li>
          In &ldquo;Send from mailbox&rdquo;, put the mailbox&apos;s own address, such as
          info@qkil.co.uk. To have emails come from accounts@qkil.co.uk, either put that in From
          address and ask your admin to switch on &ldquo;send from aliases&rdquo;, or turn accounts
          into a shared mailbox (free) and send from it directly.
        </li>
      </ol>
    </details>
  )
}

/** Subject and message for one kind of document, with its placeholders. */
function TemplateEditor({ kind, label, template, fallback, placeholders, onChange }) {
  const bodyRef = useRef(null)

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
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{label}</h3>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ ...fallback })}>
          <RotateCcw className="h-3.5 w-3.5" />
          Reset to default
        </Button>
      </div>
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
    </section>
  )
}

/**
 * The Email tab: how email is sent, a test send, and the templates.
 *
 * `onSave()` saves every setting and resolves true on success; a test send
 * saves first, so it always tests what is on screen.
 */
export function EmailSettings({ form, set, settings, saving, dirty, onSave, SaveBar }) {
  const user = useAuthStore((state) => state.user)
  const [testTo, setTestTo] = useState(user?.email ?? '')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  const provider = form.email_provider || 'none'
  const placeholders = settings?.email_placeholders ?? { common: [] }
  const defaults = settings?.default_email_templates ?? {}
  const templates = form.email_templates ?? defaults

  async function handleTest() {
    setTestResult(null)
    if (dirty) {
      const saved = await onSave()
      if (!saved) return
    }
    setTesting(true)
    try {
      const response = await sendTestEmail(testTo.trim())
      setTestResult({ ok: true, message: `${response.message}. Check the inbox (and junk folder).` })
    } catch (err) {
      setTestResult({ ok: false, message: toApiError(err, 'The test email could not be sent').message })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Sending email</CardTitle>
          <CardDescription>
            How QKil emails quotes, invoices and reports to your customers. Passwords and secrets
            are stored encrypted and never shown again.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Field label="Send with">
            <ChoiceChips
              ariaLabel="Email provider"
              options={PROVIDERS}
              labels={PROVIDER_LABELS}
              value={provider}
              onChange={(value) => set('email_provider', value || 'none')}
            />
          </Field>

          {provider === 'microsoft365' ? (
            <div className="space-y-4">
              <MicrosoftGuide />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Directory (tenant) ID" htmlFor="m365_tenant_id" hint="Or your domain, e.g. qkil.co.uk">
                  <Input
                    id="m365_tenant_id"
                    value={form.m365_tenant_id}
                    onChange={(event) => set('m365_tenant_id', event.target.value)}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    autoComplete="off"
                  />
                </Field>
                <Field label="Application (client) ID" htmlFor="m365_client_id">
                  <Input
                    id="m365_client_id"
                    value={form.m365_client_id}
                    onChange={(event) => set('m365_client_id', event.target.value)}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    autoComplete="off"
                  />
                </Field>
                <SecretField
                  label="Client secret"
                  htmlFor="m365_client_secret"
                  isSet={settings?.m365_client_secret_set}
                  value={form.m365_client_secret}
                  onChange={(value) => set('m365_client_secret', value)}
                  hint="The secret's Value, from Certificates & secrets."
                />
                <Field
                  label="Send from mailbox"
                  htmlFor="m365_mailbox"
                  hint="The mailbox itself (not an alias), e.g. info@qkil.co.uk."
                >
                  <Input
                    id="m365_mailbox"
                    type="email"
                    value={form.m365_mailbox}
                    onChange={(event) => set('m365_mailbox', event.target.value)}
                    placeholder="info@qkil.co.uk"
                    autoComplete="off"
                  />
                </Field>
              </div>
            </div>
          ) : null}

          {provider === 'smtp' ? (
            <div className="space-y-4">
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                For Microsoft 365 mailboxes, use the Microsoft 365 option instead: Microsoft is
                switching off password sign-in for SMTP (from the end of 2026).
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="SMTP server" htmlFor="smtp_host">
                  <Input
                    id="smtp_host"
                    value={form.smtp_host}
                    onChange={(event) => set('smtp_host', event.target.value)}
                    placeholder="smtp.example.com"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Port" htmlFor="smtp_port">
                    <Input
                      id="smtp_port"
                      type="number"
                      min="1"
                      max="65535"
                      value={form.smtp_port}
                      onChange={(event) => set('smtp_port', event.target.value)}
                      placeholder="587"
                    />
                  </Field>
                  <Field label="Security" htmlFor="smtp_security">
                    <select
                      id="smtp_security"
                      value={form.smtp_security}
                      onChange={(event) => set('smtp_security', event.target.value)}
                      className={SELECT_CLASSES}
                    >
                      <option value="starttls">STARTTLS (587)</option>
                      <option value="ssl">SSL (465)</option>
                      <option value="none">None</option>
                    </select>
                  </Field>
                </div>
                <Field
                  label="Username"
                  htmlFor="smtp_username"
                  hint="Usually the mailbox's own address, not an alias."
                >
                  <Input
                    id="smtp_username"
                    value={form.smtp_username}
                    onChange={(event) => set('smtp_username', event.target.value)}
                    autoComplete="off"
                  />
                </Field>
                <SecretField
                  label="Password"
                  htmlFor="smtp_password"
                  isSet={settings?.smtp_password_set}
                  value={form.smtp_password}
                  onChange={(value) => set('smtp_password', value)}
                />
              </div>
            </div>
          ) : null}

          {provider !== 'none' ? (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground">What customers see</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="From name" htmlFor="smtp_from_name">
                  <Input
                    id="smtp_from_name"
                    value={form.smtp_from_name}
                    onChange={(event) => set('smtp_from_name', event.target.value)}
                    placeholder="QKil Pest Control"
                  />
                </Field>
                <Field
                  label="From address"
                  htmlFor="smtp_from_email"
                  hint={provider === 'microsoft365' ? 'Leave empty to send as the mailbox.' : undefined}
                >
                  <Input
                    id="smtp_from_email"
                    type="email"
                    value={form.smtp_from_email}
                    onChange={(event) => set('smtp_from_email', event.target.value)}
                    placeholder="accounts@qkil.co.uk"
                  />
                </Field>
                <Field label="Replies go to" htmlFor="email_reply_to" hint="Optional.">
                  <Input
                    id="email_reply_to"
                    type="email"
                    value={form.email_reply_to}
                    onChange={(event) => set('email_reply_to', event.target.value)}
                    placeholder="accounts@qkil.co.uk"
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
                    placeholder="info@qkil.co.uk"
                  />
                </Field>
              </div>
            </div>
          ) : null}

          {provider !== 'none' ? (
            <CheckboxField
              id="email_technicians"
              checked={form.email_technicians !== false}
              onChange={(checked) => set('email_technicians', checked)}
              label="Email technicians when they're given a job"
              description="With the date, address, site contact and a link to the job. One email covers a whole repeating series."
            />
          ) : null}

          {provider !== 'none' ? (
            <div className="space-y-3 rounded-md border border-border p-4">
              <h3 className="text-sm font-semibold text-foreground">Check it works</h3>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  type="email"
                  aria-label="Send the test email to"
                  value={testTo}
                  onChange={(event) => setTestTo(event.target.value)}
                  placeholder="you@example.com"
                  className="sm:max-w-xs"
                />
                <Button variant="outline" disabled={testing || saving || !testTo.trim()} onClick={() => void handleTest()}>
                  {testing ? <Spinner size="sm" /> : <Send className="h-4 w-4" />}
                  {testing ? 'Sending...' : dirty ? 'Save and send test email' : 'Send test email'}
                </Button>
              </div>
              {testResult ? (
                <div
                  className={cn(
                    'flex items-start gap-2 rounded-md p-3 text-sm',
                    testResult.ok ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive',
                  )}
                >
                  {testResult.ok ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  ) : (
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  )}
                  <span>{testResult.message}</span>
                </div>
              ) : null}
            </div>
          ) : null}

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
        <CardContent className="space-y-8">
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
          <SaveBar saving={saving} dirty={dirty} onSave={() => void onSave()} />
        </CardContent>
      </Card>
    </div>
  )
}

export default EmailSettings
