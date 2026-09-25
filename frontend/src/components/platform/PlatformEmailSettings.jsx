import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Send } from 'lucide-react'

import {
  getPlatformSettings,
  sendPlatformTestEmail,
  updatePlatformSettings,
} from '@/api/platformSettings'
import { ChoiceChips, SELECT_CLASSES } from '@/components/jobs/JobFormControls'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingState, Spinner } from '@/components/ui/spinner'
import { toastError, toastSuccess } from '@/components/ui/use-toast'
import { toApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'

const PROVIDERS = ['none', 'microsoft365', 'smtp']

const PROVIDER_LABELS = {
  none: 'Not set up',
  microsoft365: 'Microsoft 365',
  smtp: 'Other provider (SMTP)',
}

const EMPTY = {
  email_provider: 'none',
  smtp_host: '',
  smtp_port: '',
  smtp_security: 'starttls',
  smtp_username: '',
  smtp_password: '',
  m365_tenant_id: '',
  m365_client_id: '',
  m365_client_secret: '',
  m365_mailbox: '',
  smtp_from_email: '',
  smtp_from_name: '',
}

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
      hint={hint ?? (isSet ? 'Saved. Type a new one to replace it.' : undefined)}
    >
      <Input
        id={htmlFor}
        type="password"
        autoComplete="new-password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={isSet ? '••••••••' : ''}
      />
    </Field>
  )
}

/**
 * How PestBase sends email, for every client.
 *
 * One mail account serves the whole platform, so this is the only place the
 * provider, server and credentials are configured. What each client sets for
 * itself is what its own customers see and act on - the reply-to address, the
 * office copy, and the wording of the templates.
 */
export function PlatformEmailSettings() {
  const user = useAuthStore((state) => state.user)

  const [saved, setSaved] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const [testTo, setTestTo] = useState(user?.email ?? '')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getPlatformSettings()
      setSaved(data)
      setForm({
        ...EMPTY,
        email_provider: data.email_provider ?? 'none',
        smtp_host: data.smtp_host ?? '',
        smtp_port: data.smtp_port == null ? '' : String(data.smtp_port),
        smtp_security: data.smtp_security ?? 'starttls',
        smtp_username: data.smtp_username ?? '',
        m365_tenant_id: data.m365_tenant_id ?? '',
        m365_client_id: data.m365_client_id ?? '',
        m365_mailbox: data.m365_mailbox ?? '',
        smtp_from_email: data.smtp_from_email ?? '',
        smtp_from_name: data.smtp_from_name ?? '',
      })
      setDirty(false)
    } catch (err) {
      toastError('Could not load the platform settings', toApiError(err).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function set(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
    setDirty(true)
  }

  async function save() {
    setSaving(true)
    try {
      const payload = {
        email_provider: form.email_provider,
        smtp_host: form.smtp_host || null,
        // An empty port means "use the default for the security setting", which
        // the server decides - so it must go as null, not as an empty string.
        smtp_port: form.smtp_port ? Number(form.smtp_port) : null,
        smtp_security: form.smtp_security,
        smtp_username: form.smtp_username || null,
        m365_tenant_id: form.m365_tenant_id || null,
        m365_client_id: form.m365_client_id || null,
        m365_mailbox: form.m365_mailbox || null,
        smtp_from_email: form.smtp_from_email || null,
        smtp_from_name: form.smtp_from_name || null,
        // Only sent when typed: blank means keep what is stored.
        ...(form.smtp_password ? { smtp_password: form.smtp_password } : {}),
        ...(form.m365_client_secret ? { m365_client_secret: form.m365_client_secret } : {}),
      }
      const data = await updatePlatformSettings(payload)
      setSaved(data)
      setForm((current) => ({ ...current, smtp_password: '', m365_client_secret: '' }))
      setDirty(false)
      toastSuccess('Platform settings saved', 'Every client sends through these settings.')
      return true
    } catch (err) {
      toastError('Could not save', toApiError(err).message)
      return false
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTestResult(null)
    if (dirty && !(await save())) return

    setTesting(true)
    try {
      const response = await sendPlatformTestEmail(testTo.trim())
      setTestResult({
        ok: true,
        message: `${response.message}. Check the inbox (and the junk folder).`,
      })
    } catch (err) {
      setTestResult({
        ok: false,
        message: toApiError(err, 'The test email could not be sent').message,
      })
    } finally {
      setTesting(false)
    }
  }

  if (loading) return <LoadingState message="Loading the platform settings..." />

  const provider = form.email_provider || 'none'

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Sending email</CardTitle>
          <CardDescription>
            One mail account for every client. Each client still chooses where replies go, who gets
            a copy, and the wording of their own emails. Passwords and secrets are stored encrypted
            and never shown again.
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
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Directory (tenant) ID" htmlFor="m365_tenant_id">
                <Input
                  id="m365_tenant_id"
                  value={form.m365_tenant_id}
                  onChange={(event) => set('m365_tenant_id', event.target.value)}
                  placeholder="contoso.onmicrosoft.com"
                />
              </Field>
              <Field label="Application (client) ID" htmlFor="m365_client_id">
                <Input
                  id="m365_client_id"
                  value={form.m365_client_id}
                  onChange={(event) => set('m365_client_id', event.target.value)}
                />
              </Field>
              <SecretField
                label="Client secret"
                htmlFor="m365_client_secret"
                isSet={saved?.m365_client_secret_set}
                value={form.m365_client_secret}
                onChange={(value) => set('m365_client_secret', value)}
              />
              <Field
                label="Send from this mailbox"
                htmlFor="m365_mailbox"
                hint="The mailbox the app is allowed to send as."
              >
                <Input
                  id="m365_mailbox"
                  type="email"
                  value={form.m365_mailbox}
                  onChange={(event) => set('m365_mailbox', event.target.value)}
                  placeholder="noreply@pestbase.co.uk"
                />
              </Field>
            </div>
          ) : null}

          {provider === 'smtp' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Server" htmlFor="smtp_host">
                <Input
                  id="smtp_host"
                  value={form.smtp_host}
                  onChange={(event) => set('smtp_host', event.target.value)}
                  placeholder="smtp.postmarkapp.com"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Port" htmlFor="smtp_port" hint="Blank uses the usual one.">
                  <Input
                    id="smtp_port"
                    inputMode="numeric"
                    value={form.smtp_port}
                    onChange={(event) => set('smtp_port', event.target.value)}
                    placeholder="587"
                  />
                </Field>
                <Field label="Security" htmlFor="smtp_security">
                  <select
                    id="smtp_security"
                    className={SELECT_CLASSES}
                    value={form.smtp_security}
                    onChange={(event) => set('smtp_security', event.target.value)}
                  >
                    <option value="starttls">STARTTLS</option>
                    <option value="ssl">SSL/TLS</option>
                    <option value="none">None</option>
                  </select>
                </Field>
              </div>
              <Field label="Username" htmlFor="smtp_username">
                <Input
                  id="smtp_username"
                  value={form.smtp_username}
                  onChange={(event) => set('smtp_username', event.target.value)}
                />
              </Field>
              <SecretField
                label="Password"
                htmlFor="smtp_password"
                isSet={saved?.smtp_password_set}
                value={form.smtp_password}
                onChange={(value) => set('smtp_password', value)}
              />
            </div>
          ) : null}

          {provider !== 'none' ? (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground">The address mail comes from</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="From name"
                  htmlFor="smtp_from_name"
                  hint="Leave empty and each client's own company name is used, so their customers still see who wrote."
                >
                  <Input
                    id="smtp_from_name"
                    value={form.smtp_from_name}
                    onChange={(event) => set('smtp_from_name', event.target.value)}
                    placeholder="(the client's company name)"
                  />
                </Field>
                <Field
                  label="From address"
                  htmlFor="smtp_from_email"
                  hint={
                    provider === 'microsoft365'
                      ? 'Leave empty to send as the mailbox above.'
                      : 'Must be an address this mail server may send as.'
                  }
                >
                  <Input
                    id="smtp_from_email"
                    type="email"
                    value={form.smtp_from_email}
                    onChange={(event) => set('smtp_from_email', event.target.value)}
                    placeholder="noreply@pestbase.co.uk"
                  />
                </Field>
              </div>
            </div>
          ) : null}

          {provider !== 'none' ? (
            <div className="space-y-3 rounded-md border border-border p-4">
              <h3 className="text-sm font-semibold text-foreground">Check it works</h3>
              <p className="text-xs text-muted-foreground">
                Sends using these settings alone, without borrowing any client's configuration.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  type="email"
                  aria-label="Send the test email to"
                  value={testTo}
                  onChange={(event) => setTestTo(event.target.value)}
                  placeholder="you@example.com"
                  className="sm:max-w-xs"
                />
                <Button
                  variant="outline"
                  disabled={testing || saving || !testTo.trim()}
                  onClick={() => void handleTest()}
                >
                  {testing ? <Spinner size="sm" /> : <Send className="h-4 w-4" />}
                  {testing ? 'Sending...' : 'Send a test email'}
                </Button>
              </div>

              {testResult ? (
                <div
                  role="status"
                  className={cn(
                    'flex items-start gap-2 rounded-md border p-3 text-sm',
                    testResult.ok
                      ? 'border-primary/30 bg-primary/5 text-primary'
                      : 'border-destructive/30 bg-destructive/10 text-destructive',
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

          <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
            {dirty ? (
              <span className="text-sm text-amber-600 dark:text-amber-400">Unsaved changes</span>
            ) : null}
            <Button disabled={saving} onClick={() => void save()}>
              {saving ? (
                <>
                  <Spinner size="sm" className="text-current" />
                  Saving...
                </>
              ) : (
                'Save changes'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default PlatformEmailSettings
