import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  Building2,
  ExternalLink,
  ImageOff,
  Info,
  Mail,
  Palette,
  Receipt,
  Trash2,
  Upload,
  UserCog,
} from 'lucide-react'

import {
  getLogoUrl,
  getSettings,
  removeLogo,
  updateSettings,
  uploadLogo,
} from '@/api/settings'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingState, Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { toastError, toastSuccess } from '@/components/ui/use-toast'
import { toApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { DEFAULT_PRIMARY_COLOR, MAX_LOGO_BYTES } from '@/lib/constants'

const TABS = [
  { key: 'company', label: 'Company Profile', icon: Building2 },
  { key: 'documents', label: 'Invoice & Quote Defaults', icon: Receipt },
  { key: 'email', label: 'Email', icon: Mail },
  { key: 'users', label: 'Users', icon: UserCog },
  { key: 'appearance', label: 'Appearance', icon: Palette },
]

/** Every field the form owns, so a partial API response cannot leave holes. */
const EMPTY_FORM = {
  company_name: '',
  company_number: '',
  vat_number: '',
  phone: '',
  email: '',
  website: '',
  address_street: '',
  address_city: '',
  address_county: '',
  address_postcode: '',
  address_country: 'United Kingdom',
  default_tax_rate: 20,
  default_payment_terms_days: 14,
  default_invoice_terms: '',
  default_payment_instructions: '',
  invoice_prefix: 'INV',
  quote_prefix: 'QTE',
  booking_prefix: 'JOB',
  job_prefix: 'RPT',
  default_quote_valid_days: 30,
  default_quote_terms: '',
  smtp_host: '',
  smtp_port: '',
  smtp_username: '',
  smtp_from_email: '',
  smtp_from_name: '',
  primary_color: DEFAULT_PRIMARY_COLOR,
}

/** API shape -> form shape. The tax rate is a fraction on the wire, a % here. */
function toForm(settings) {
  if (!settings) return EMPTY_FORM
  return {
    ...EMPTY_FORM,
    ...Object.fromEntries(
      Object.keys(EMPTY_FORM)
        .filter((key) => settings[key] !== undefined && settings[key] !== null)
        .map((key) => [key, settings[key]]),
    ),
    default_tax_rate: Math.round((Number(settings.default_tax_rate ?? 0.2) || 0) * 10000) / 100,
    smtp_port: settings.smtp_port ?? '',
  }
}

/** Form shape -> API shape. Blank optional strings are sent as null. */
function toPayload(form) {
  const optional = (value) => {
    const trimmed = String(value ?? '').trim()
    return trimmed === '' ? null : trimmed
  }

  return {
    company_name: String(form.company_name ?? '').trim(),
    company_number: optional(form.company_number),
    vat_number: optional(form.vat_number),
    phone: optional(form.phone),
    email: optional(form.email),
    website: optional(form.website),
    address_street: optional(form.address_street),
    address_city: optional(form.address_city),
    address_county: optional(form.address_county),
    address_postcode: optional(form.address_postcode),
    address_country: String(form.address_country ?? 'United Kingdom').trim() || 'United Kingdom',
    default_tax_rate: Math.min(Math.max(Number(form.default_tax_rate) || 0, 0), 100) / 100,
    default_payment_terms_days: Math.max(Number(form.default_payment_terms_days) || 0, 0),
    default_invoice_terms: String(form.default_invoice_terms ?? '').trim(),
    default_payment_instructions: optional(form.default_payment_instructions),
    invoice_prefix: String(form.invoice_prefix ?? 'INV').trim().toUpperCase() || 'INV',
    quote_prefix: String(form.quote_prefix ?? 'QTE').trim().toUpperCase() || 'QTE',
    booking_prefix: String(form.booking_prefix ?? 'JOB').trim().toUpperCase() || 'JOB',
    job_prefix: String(form.job_prefix ?? 'RPT').trim().toUpperCase() || 'RPT',
    default_quote_valid_days: Math.max(Number(form.default_quote_valid_days) || 1, 1),
    default_quote_terms: optional(form.default_quote_terms),
    smtp_host: optional(form.smtp_host),
    smtp_port: form.smtp_port === '' || form.smtp_port === null ? null : Number(form.smtp_port),
    smtp_username: optional(form.smtp_username),
    smtp_from_email: optional(form.smtp_from_email),
    smtp_from_name: optional(form.smtp_from_name),
    primary_color: String(form.primary_color ?? DEFAULT_PRIMARY_COLOR).trim() || DEFAULT_PRIMARY_COLOR,
  }
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

function SaveBar({ saving, onSave, dirty }) {
  return (
    <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
      {dirty ? (
        <span className="text-sm text-amber-600 dark:text-amber-400">Unsaved changes</span>
      ) : null}
      <Button disabled={saving} onClick={onSave}>
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
  )
}

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState('company')

  const [settings, setSettings] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [dirty, setDirty] = useState(false)

  // Logo state: `pendingLogo` is the file chosen but not yet uploaded.
  const [pendingLogo, setPendingLogo] = useState(null)
  const [pendingPreview, setPendingPreview] = useState(null)
  const [logoVersion, setLogoVersion] = useState(() => Date.now())
  const [logoBroken, setLogoBroken] = useState(false)
  const fileInputRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getSettings()
      setSettings(data)
      setForm(toForm(data))
      setDirty(false)
      setLogoBroken(!data?.has_logo)
    } catch (err) {
      setError(toApiError(err, 'Could not load the company settings'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Release the object URL behind the preview when it is replaced or cleared.
  useEffect(() => {
    if (!pendingLogo) {
      setPendingPreview(null)
      return undefined
    }

    const url = URL.createObjectURL(pendingLogo)
    setPendingPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [pendingLogo])

  const set = useCallback((key, value) => {
    setForm((current) => ({ ...current, [key]: value }))
    setDirty(true)
  }, [])

  function pickLogo(event) {
    const file = event.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      toastError('Not an image', 'Choose a PNG, JPEG or WebP file.')
      event.target.value = ''
      return
    }

    if (file.size > MAX_LOGO_BYTES) {
      toastError('Image too large', 'The logo must be smaller than 2 MB.')
      event.target.value = ''
      return
    }

    setPendingLogo(file)
  }

  function cancelPendingLogo() {
    setPendingLogo(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleRemoveLogo() {
    setSaving(true)
    try {
      const updated = await removeLogo()
      setSettings(updated)
      cancelPendingLogo()
      setLogoBroken(true)
      setLogoVersion(Date.now())
      toastSuccess('Logo removed', 'PDF headers will show the company name instead.')
    } catch (err) {
      toastError('Could not remove the logo', toApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  async function save() {
    if (!String(form.company_name ?? '').trim()) {
      toastError('Company name is required', 'It appears on every document you send.')
      setActiveTab('company')
      return
    }

    setSaving(true)
    try {
      if (pendingLogo) {
        await uploadLogo(pendingLogo)
        cancelPendingLogo()
        setLogoBroken(false)
        setLogoVersion(Date.now())
      }

      const updated = await updateSettings(toPayload(form))
      setSettings(updated)
      setForm(toForm(updated))
      setDirty(false)
      toastSuccess('Settings saved', 'Your changes apply to new documents right away.')
    } catch (err) {
      toastError('Could not save the settings', toApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  const logoSrc = useMemo(
    () => (pendingPreview ? pendingPreview : getLogoUrl(logoVersion)),
    [pendingPreview, logoVersion],
  )

  const showLogo = Boolean(pendingPreview) || (settings?.has_logo && !logoBroken)

  if (loading) {
    return (
      <Card>
        <LoadingState message="Loading company settings..." />
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <AlertCircle className="h-10 w-10 text-destructive" />
          <div>
            <p className="font-medium text-foreground">
              Could not load settings
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
          </div>
          <Button variant="outline" onClick={() => void load()}>
            Try again
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Settings"
        description={
          <>
            Company details, document defaults and branding. These feed every quote, invoice and
            inspection report QKil generates.
          </>
        }
      />

      <div className="flex flex-wrap gap-2 border-b border-border pb-3">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.key

          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              aria-pressed={isActive}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* ---------------------------------------------------------------- */}
      {activeTab === 'company' ? (
        <Card>
          <CardHeader>
            <CardTitle>Company profile</CardTitle>
            <CardDescription>
              Your legal name, company number and contact details as they appear on customer
              documents.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Company name *" htmlFor="company_name" className="sm:col-span-2">
                <Input
                  id="company_name"
                  value={form.company_name}
                  onChange={(event) => set('company_name', event.target.value)}
                  placeholder="QKil Pest Control"
                  hasError={!String(form.company_name ?? '').trim()}
                />
              </Field>

              <Field
                label="Company Number"
                htmlFor="company_number"
                hint="8-digit Companies House number."
              >
                <Input
                  id="company_number"
                  value={form.company_number}
                  onChange={(event) => set('company_number', event.target.value)}
                  placeholder="12345678"
                />
              </Field>

              <Field label="VAT Number" htmlFor="vat_number" hint="e.g. GB123456789">
                <Input
                  id="vat_number"
                  value={form.vat_number}
                  onChange={(event) => set('vat_number', event.target.value)}
                  placeholder="GB123456789"
                />
              </Field>

              <Field label="Phone" htmlFor="phone">
                <Input
                  id="phone"
                  value={form.phone}
                  onChange={(event) => set('phone', event.target.value)}
                  placeholder="020 7946 0000"
                />
              </Field>

              <Field label="Email" htmlFor="email">
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(event) => set('email', event.target.value)}
                  placeholder="admin@qkil.co.uk"
                />
              </Field>

              <Field label="Website" htmlFor="website" className="sm:col-span-2">
                <Input
                  id="website"
                  value={form.website}
                  onChange={(event) => set('website', event.target.value)}
                  placeholder="www.qkil.co.uk"
                />
              </Field>
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Address</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Street" htmlFor="address_street" className="sm:col-span-2">
                  <Input
                    id="address_street"
                    value={form.address_street}
                    onChange={(event) => set('address_street', event.target.value)}
                    placeholder="1 Pest House Lane"
                  />
                </Field>

                <Field label="Town / City" htmlFor="address_city">
                  <Input
                    id="address_city"
                    value={form.address_city}
                    onChange={(event) => set('address_city', event.target.value)}
                    placeholder="London"
                  />
                </Field>

                <Field label="County" htmlFor="address_county">
                  <Input
                    id="address_county"
                    value={form.address_county}
                    onChange={(event) => set('address_county', event.target.value)}
                    placeholder="Greater London"
                  />
                </Field>

                <Field label="Postcode" htmlFor="address_postcode">
                  <Input
                    id="address_postcode"
                    value={form.address_postcode}
                    onChange={(event) => set('address_postcode', event.target.value)}
                    placeholder="EC1A 1BB"
                  />
                </Field>

                <Field label="Country" htmlFor="address_country">
                  <Input
                    id="address_country"
                    value={form.address_country}
                    onChange={(event) => set('address_country', event.target.value)}
                    placeholder="United Kingdom"
                  />
                </Field>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Logo</h3>
              <p className="text-xs text-muted-foreground">
                Shown in the header of every generated PDF. PNG, JPEG or WebP, up to 2 MB.
              </p>

              <div className="flex flex-wrap items-center gap-4">
                <div className="flex h-24 w-44 items-center justify-center overflow-hidden rounded-md border border-dashed border-input bg-muted/50">
                  {showLogo ? (
                    <img
                      src={logoSrc}
                      alt="Company logo"
                      className="max-h-20 max-w-40 object-contain"
                      onError={(event) => {
                        event.target.style.display = 'none'
                        setLogoBroken(true)
                      }}
                    />
                  ) : (
                    <span className="flex flex-col items-center gap-1 text-xs text-muted-foreground/70">
                      <ImageOff className="h-6 w-6" />
                      No logo
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={pickLogo}
                    className="hidden"
                    id="logo-file"
                  />
                  <Button
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={saving}
                  >
                    <Upload className="h-4 w-4" />
                    Choose image
                  </Button>

                  {pendingLogo ? (
                    <Button variant="ghost" onClick={cancelPendingLogo} disabled={saving}>
                      Cancel
                    </Button>
                  ) : null}

                  {settings?.has_logo && !pendingLogo ? (
                    <Button
                      variant="outline"
                      onClick={() => void handleRemoveLogo()}
                      disabled={saving}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                      Remove logo
                    </Button>
                  ) : null}
                </div>
              </div>

              {pendingLogo ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {pendingLogo.name} is ready to upload. It is stored when you save.
                </p>
              ) : null}
            </div>

            <SaveBar saving={saving} dirty={dirty || Boolean(pendingLogo)} onSave={() => void save()} />
          </CardContent>
        </Card>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {activeTab === 'documents' ? (
        <Card>
          <CardHeader>
            <CardTitle>Invoice &amp; quote defaults</CardTitle>
            <CardDescription>
              Applied to every new document, including record-number prefixes. Existing
              documents keep the values and numbers they were created with.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Default tax rate (%)"
                htmlFor="default_tax_rate"
                hint="VAT in the UK is 20%."
              >
                <Input
                  id="default_tax_rate"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={form.default_tax_rate}
                  onChange={(event) => set('default_tax_rate', event.target.value)}
                />
              </Field>

              <Field
                label="Payment terms (days)"
                htmlFor="default_payment_terms_days"
                hint="Days between the issue date and the due date."
              >
                <Input
                  id="default_payment_terms_days"
                  type="number"
                  min="0"
                  max="365"
                  value={form.default_payment_terms_days}
                  onChange={(event) => set('default_payment_terms_days', event.target.value)}
                />
              </Field>

              <Field label="Invoice prefix" htmlFor="invoice_prefix" hint="e.g. INV-0001">
                <Input
                  id="invoice_prefix"
                  value={form.invoice_prefix}
                  onChange={(event) => set('invoice_prefix', event.target.value)}
                  maxLength={8}
                />
              </Field>

              <Field label="Quote prefix" htmlFor="quote_prefix" hint="e.g. QTE-0001">
                <Input
                  id="quote_prefix"
                  value={form.quote_prefix}
                  onChange={(event) => set('quote_prefix', event.target.value)}
                  maxLength={8}
                />
              </Field>

              <Field label="Job number prefix" htmlFor="booking_prefix" hint="e.g. JOB-0001">
                <Input
                  id="booking_prefix"
                  value={form.booking_prefix}
                  onChange={(event) => set('booking_prefix', event.target.value)}
                  maxLength={8}
                />
              </Field>

              <Field label="Report number prefix" htmlFor="job_prefix" hint="e.g. RPT-0001">
                <Input
                  id="job_prefix"
                  value={form.job_prefix}
                  onChange={(event) => set('job_prefix', event.target.value)}
                  maxLength={8}
                />
              </Field>

              <Field
                label="Quote valid for (days)"
                htmlFor="default_quote_valid_days"
                className="sm:col-span-2"
              >
                <Input
                  id="default_quote_valid_days"
                  type="number"
                  min="1"
                  max="365"
                  value={form.default_quote_valid_days}
                  onChange={(event) => set('default_quote_valid_days', event.target.value)}
                />
              </Field>
            </div>

            <Field label="Default invoice terms" htmlFor="default_invoice_terms">
              <Textarea
                id="default_invoice_terms"
                rows={3}
                value={form.default_invoice_terms}
                onChange={(event) => set('default_invoice_terms', event.target.value)}
                placeholder="Payment due within 14 days. VAT registered under GB123456789."
              />
            </Field>

            <Field
              label="Default payment instructions"
              htmlFor="default_payment_instructions"
              hint="Bank details printed in a box at the foot of every invoice."
            >
              <Textarea
                id="default_payment_instructions"
                rows={3}
                value={form.default_payment_instructions}
                onChange={(event) => set('default_payment_instructions', event.target.value)}
                placeholder="Sort Code: 20-00-00  Account No: 12345678  Account Name: QKil Pest Control Ltd"
              />
            </Field>

            <Field label="Default quote terms" htmlFor="default_quote_terms">
              <Textarea
                id="default_quote_terms"
                rows={3}
                value={form.default_quote_terms}
                onChange={(event) => set('default_quote_terms', event.target.value)}
                placeholder="Quote valid for 30 days. VAT included."
              />
            </Field>

            <SaveBar saving={saving} dirty={dirty} onSave={() => void save()} />
          </CardContent>
        </Card>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {activeTab === 'email' ? (
        <Card>
          <CardHeader>
            <CardTitle>Email configuration</CardTitle>
            <CardDescription>
              Where outgoing quotes and invoices will be sent from.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-start gap-3 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Email sending is configured but not active in this version. These settings will be
                used in a future update.
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="SMTP host" htmlFor="smtp_host">
                <Input
                  id="smtp_host"
                  value={form.smtp_host}
                  onChange={(event) => set('smtp_host', event.target.value)}
                  placeholder="smtp.example.com"
                />
              </Field>

              <Field label="SMTP port" htmlFor="smtp_port">
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

              <Field label="SMTP username" htmlFor="smtp_username">
                <Input
                  id="smtp_username"
                  value={form.smtp_username}
                  onChange={(event) => set('smtp_username', event.target.value)}
                  placeholder="accounts@qkil.co.uk"
                />
              </Field>

              <Field label="From email" htmlFor="smtp_from_email">
                <Input
                  id="smtp_from_email"
                  type="email"
                  value={form.smtp_from_email}
                  onChange={(event) => set('smtp_from_email', event.target.value)}
                  placeholder="accounts@qkil.co.uk"
                />
              </Field>

              <Field label="From name" htmlFor="smtp_from_name" className="sm:col-span-2">
                <Input
                  id="smtp_from_name"
                  value={form.smtp_from_name}
                  onChange={(event) => set('smtp_from_name', event.target.value)}
                  placeholder="QKil Pest Control"
                />
              </Field>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
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
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {activeTab === 'users' ? (
        <Card>
          <CardHeader>
            <CardTitle>Users</CardTitle>
            <CardDescription>
              Staff accounts and what each person can access.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              User management lives on its own page, where you can create accounts, change roles
              and deactivate people who have left.
            </p>

            <div className="rounded-md border border-border bg-muted/50 p-4 text-sm">
              <p className="font-medium text-foreground">Roles</p>
              <ul className="mt-2 space-y-1.5 text-muted-foreground">
                <li>
                  <Badge variant="default" className="mr-2">
                    Admin
                  </Badge>
                  Everything, including these settings and user management.
                </li>
                <li>
                  <Badge variant="info" className="mr-2">
                    Office Staff
                  </Badge>
                  Customers, quotes, bookings, jobs and invoicing.
                </li>
                <li>
                  <Badge variant="secondary" className="mr-2">
                    Technician
                  </Badge>
                  Their own jobs and inspection reports. No access to money.
                </li>
              </ul>
            </div>

            <Button asChild variant="outline">
              <Link to="/users">
                Manage users
                <ExternalLink className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {activeTab === 'appearance' ? (
        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>The accent colour used on generated documents.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-wrap items-end gap-4">
              <Field label="Primary colour" htmlFor="primary_color">
                <div className="flex items-center gap-3">
                  <input
                    id="primary_color"
                    type="color"
                    value={form.primary_color}
                    onChange={(event) => set('primary_color', event.target.value)}
                    className="h-10 w-16 cursor-pointer rounded-md border border-input bg-card p-1"
                  />
                  <Input
                    value={form.primary_color}
                    onChange={(event) => set('primary_color', event.target.value)}
                    className="w-32 font-mono uppercase"
                    maxLength={7}
                    aria-label="Primary colour hex value"
                  />
                  <Button
                    variant="ghost"
                    onClick={() => set('primary_color', DEFAULT_PRIMARY_COLOR)}
                  >
                    Reset
                  </Button>
                </div>
              </Field>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Preview</h3>
              <div className="flex flex-wrap items-center gap-4 rounded-md border border-border bg-muted/50 p-5">
                <span
                  className="inline-flex h-10 items-center rounded-md px-4 text-sm font-medium text-white shadow-sm"
                  style={{ backgroundColor: form.primary_color }}
                >
                  Sample button
                </span>
                <span
                  className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
                  style={{ backgroundColor: form.primary_color }}
                >
                  Sample badge
                </span>
                <span
                  className="text-lg font-bold"
                  style={{ color: form.primary_color }}
                >
                  {form.company_name || 'QKil Pest Control'}
                </span>
                <span
                  className="h-1 w-full rounded"
                  style={{ backgroundColor: form.primary_color }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Colour changes apply to PDF documents. The app UI uses the default emerald theme.
              </p>
            </div>

            <SaveBar saving={saving} dirty={dirty} onSave={() => void save()} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

export default SettingsPage
