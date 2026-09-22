import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  Building2,
  ClipboardList,
  ExternalLink,
  ImageOff,
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
import { CheckboxField } from '@/components/jobs/JobFormControls'
import { EmailSettings } from '@/components/settings/EmailSettings'
import {
  ProductListEditor,
  isBlankProduct,
} from '@/components/settings/ProductListEditor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingState, Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { toastError, toastSuccess } from '@/components/ui/use-toast'
import { primeCompanySettings } from '@/hooks/useCompanySettings'
import { toApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { DEFAULT_PRIMARY_COLOR, MAX_LOGO_BYTES } from '@/lib/constants'

const TABS = [
  { key: 'company', label: 'Company Profile', icon: Building2 },
  { key: 'documents', label: 'Invoicing', icon: Receipt },
  { key: 'reports', label: 'Reports', icon: ClipboardList },
  { key: 'email', label: 'Email', icon: Mail },
  { key: 'users', label: 'Users', icon: UserCog },
  { key: 'appearance', label: 'Appearance', icon: Palette },
]

/** Every field the form owns, so a partial API response cannot leave holes. */
const EMPTY_FORM = {
  company_name: '',
  legal_name: '',
  company_number: '',
  vat_number: '',
  vat_registered: false,
  bank_account_name: '',
  bank_sort_code: '',
  bank_account_number: '',
  next_invoice_number: '',
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
  products: [],
  report_insecticide_guidance: '',
  report_rodenticide_guidance: '',
  report_declaration: '',
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
  email_reply_to: '',
  email_bcc: '',
  email_templates: null,
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
    // Secrets are write-only: the form never holds a saved one.
    smtp_password: '',
    m365_client_secret: '',
    // SMTP details saved before there was a provider choice mean SMTP.
    email_provider:
      settings.email_provider && settings.email_provider !== 'none'
        ? settings.email_provider
        : settings.smtp_host
          ? 'smtp'
          : 'none',
    products: (settings.products ?? []).map((product) => ({
      ...product,
      active_ingredient: product.active_ingredient ?? '',
      formulation: product.formulation ?? '',
      registration_number: product.registration_number ?? '',
      safety_data_sheet_ref: product.safety_data_sheet_ref ?? '',
    })),
  }
}

/**
 * Form shape -> API shape. Blank optional strings are sent as null.
 *
 * The next invoice number is only sent when it was changed, so saving some
 * other setting never collides with invoices raised in the meantime.
 */
function toPayload(form, loaded) {
  const optional = (value) => {
    const trimmed = String(value ?? '').trim()
    return trimmed === '' ? null : trimmed
  }

  return {
    company_name: String(form.company_name ?? '').trim(),
    legal_name: optional(form.legal_name),
    company_number: optional(form.company_number),
    vat_number: optional(form.vat_number),
    vat_registered: Boolean(form.vat_registered),
    bank_account_name: optional(form.bank_account_name),
    bank_sort_code: optional(form.bank_sort_code),
    bank_account_number: optional(form.bank_account_number),
    ...(Number(form.next_invoice_number) &&
    Number(form.next_invoice_number) !== loaded?.next_invoice_number
      ? { next_invoice_number: Number(form.next_invoice_number) }
      : {}),
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
    // Rows left completely empty are dropped rather than saved.
    products: form.products
      .filter((product) => !isBlankProduct(product))
      .map((product) => ({
        id: product.id || null,
        name: String(product.name ?? '').trim(),
        category: product.category,
        active_ingredient: optional(product.active_ingredient),
        formulation: optional(product.formulation),
        registration_number: optional(product.registration_number),
        safety_data_sheet_ref: optional(product.safety_data_sheet_ref),
      })),
    report_insecticide_guidance: String(form.report_insecticide_guidance ?? '').trim(),
    report_rodenticide_guidance: String(form.report_rodenticide_guidance ?? '').trim(),
    report_declaration: String(form.report_declaration ?? '').trim(),
    email_provider: form.email_provider || 'none',
    smtp_host: optional(form.smtp_host),
    smtp_port: form.smtp_port === '' || form.smtp_port === null ? null : Number(form.smtp_port),
    smtp_security: form.smtp_security || 'starttls',
    smtp_username: optional(form.smtp_username),
    // Only sent when typed: leaving them empty keeps what is saved.
    ...(form.smtp_password ? { smtp_password: form.smtp_password } : {}),
    ...(form.m365_client_secret ? { m365_client_secret: form.m365_client_secret } : {}),
    m365_tenant_id: optional(form.m365_tenant_id),
    m365_client_id: optional(form.m365_client_id),
    m365_mailbox: optional(form.m365_mailbox),
    smtp_from_email: optional(form.smtp_from_email),
    smtp_from_name: optional(form.smtp_from_name),
    email_reply_to: optional(form.email_reply_to),
    email_bcc: optional(form.email_bcc),
    ...(form.email_templates ? { email_templates: form.email_templates } : {}),
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

  /** Switching VAT on starts from the standard 20% if no rate was ever set. */
  function setVatRegistered(registered) {
    set('vat_registered', registered)
    if (registered && !Number(form.default_tax_rate)) set('default_tax_rate', 20)
  }

  /** Save every setting. Resolves true when saved. */
  async function save() {
    if (form.vat_registered && !String(form.vat_number ?? '').trim()) {
      toastError('Add your VAT number', 'A VAT invoice has to show it.')
      setActiveTab('documents')
      return false
    }

    if (!String(form.company_name ?? '').trim()) {
      toastError('Company name is required', 'It appears on every document you send.')
      setActiveTab('company')
      return false
    }

    if (form.products.some((product) => !isBlankProduct(product) && !String(product.name).trim())) {
      toastError('A product needs a name', 'Name it, or remove the row, then save again.')
      setActiveTab('reports')
      return false
    }

    setSaving(true)
    try {
      if (pendingLogo) {
        await uploadLogo(pendingLogo)
        cancelPendingLogo()
        setLogoBroken(false)
        setLogoVersion(Date.now())
      }

      const updated = await updateSettings(toPayload(form, settings))
      primeCompanySettings(updated)
      setSettings(updated)
      setForm(toForm(updated))
      setDirty(false)
      toastSuccess('Settings saved', 'Your changes apply to new documents right away.')
      return true
    } catch (err) {
      toastError('Could not save the settings', toApiError(err).message)
      return false
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
              Your names, company number and contact details as they appear on quotes, invoices
              and reports.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Company name *"
                htmlFor="company_name"
                hint="The name your customers know you by."
              >
                <Input
                  id="company_name"
                  value={form.company_name}
                  onChange={(event) => set('company_name', event.target.value)}
                  placeholder="QKil Pest Control"
                  hasError={!String(form.company_name ?? '').trim()}
                />
              </Field>

              <Field
                label="Registered company name"
                htmlFor="legal_name"
                hint="For a limited company, if different, e.g. Quikil Ltd. Printed as 'A trading name of ...'."
              >
                <Input
                  id="legal_name"
                  value={form.legal_name}
                  onChange={(event) => set('legal_name', event.target.value)}
                  placeholder="Quikil Ltd"
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

              <Field label="Website" htmlFor="website">
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
            <CardTitle>Invoicing</CardTitle>
            <CardDescription>
              VAT, how customers pay you, numbering and terms. Changes apply to new quotes and
              invoices; existing ones keep what they were created with.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            <section className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground">VAT</h3>
              <CheckboxField
                id="vat_registered"
                checked={Boolean(form.vat_registered)}
                onChange={setVatRegistered}
                label="VAT registered"
                description={
                  form.vat_registered
                    ? 'Quotes and invoices charge VAT, and invoices are VAT invoices showing your VAT number.'
                    : 'Leave off until you register. No quote or invoice charges VAT, and nothing mentions it.'
                }
              />
              {form.vat_registered ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="VAT number *" htmlFor="vat_number" hint="e.g. GB123456789">
                    <Input
                      id="vat_number"
                      value={form.vat_number}
                      onChange={(event) => set('vat_number', event.target.value)}
                      placeholder="GB123456789"
                      hasError={!String(form.vat_number ?? '').trim()}
                    />
                  </Field>
                  <Field label="VAT rate (%)" htmlFor="default_tax_rate" hint="The UK standard rate is 20%.">
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
                </div>
              ) : null}
            </section>

            <section className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Bank details</h3>
                <p className="text-xs text-muted-foreground">
                  Printed on every invoice, with the invoice number as the payment reference.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Account name" htmlFor="bank_account_name" className="sm:col-span-3">
                  <Input
                    id="bank_account_name"
                    value={form.bank_account_name}
                    onChange={(event) => set('bank_account_name', event.target.value)}
                    placeholder="As it appears on the account"
                    autoComplete="off"
                  />
                </Field>
                <Field label="Sort code" htmlFor="bank_sort_code">
                  <Input
                    id="bank_sort_code"
                    inputMode="numeric"
                    value={form.bank_sort_code}
                    onChange={(event) => set('bank_sort_code', event.target.value)}
                    placeholder="00-00-00"
                    autoComplete="off"
                  />
                </Field>
                <Field label="Account number" htmlFor="bank_account_number" className="sm:col-span-2">
                  <Input
                    id="bank_account_number"
                    inputMode="numeric"
                    value={form.bank_account_number}
                    onChange={(event) => set('bank_account_number', event.target.value)}
                    placeholder="8 digits"
                    autoComplete="off"
                  />
                </Field>
              </div>
              <Field
                label="Extra payment instructions"
                htmlFor="default_payment_instructions"
                hint="Optional. Printed under the bank details, e.g. other ways to pay."
              >
                <Textarea
                  id="default_payment_instructions"
                  rows={2}
                  value={form.default_payment_instructions}
                  onChange={(event) => set('default_payment_instructions', event.target.value)}
                  placeholder="Card payments also accepted by phone."
                />
              </Field>
            </section>

            <section className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Numbering</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Next invoice number"
                  htmlFor="next_invoice_number"
                  className="sm:col-span-2"
                  hint={
                    Number(form.next_invoice_number) > 0
                      ? `The next invoice will be ${String(form.invoice_prefix || 'INV').toUpperCase()}-${String(
                          Number(form.next_invoice_number),
                        ).padStart(4, '0')}. It can only go up, so no number is ever used twice.`
                      : 'It can only go up, so no number is ever used twice.'
                  }
                >
                  <Input
                    id="next_invoice_number"
                    type="number"
                    min={settings?.next_invoice_number ?? 1}
                    step="1"
                    value={form.next_invoice_number}
                    onChange={(event) => set('next_invoice_number', event.target.value)}
                    className="sm:w-40"
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
              </div>
            </section>

            <section className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Terms</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Payment terms (days)"
                  htmlFor="default_payment_terms_days"
                  hint="Days between the invoice date and the due date."
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

                <Field label="Quotes valid for (days)" htmlFor="default_quote_valid_days">
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

              <Field label="Invoice terms" htmlFor="default_invoice_terms">
                <Textarea
                  id="default_invoice_terms"
                  rows={3}
                  value={form.default_invoice_terms}
                  onChange={(event) => set('default_invoice_terms', event.target.value)}
                  placeholder="Payment due within 14 days. Thank you for your business."
                />
              </Field>

              <Field label="Quote terms" htmlFor="default_quote_terms">
                <Textarea
                  id="default_quote_terms"
                  rows={3}
                  value={form.default_quote_terms}
                  onChange={(event) => set('default_quote_terms', event.target.value)}
                  placeholder="Quote valid for 30 days."
                />
              </Field>
            </section>

            <SaveBar saving={saving} dirty={dirty} onSave={() => void save()} />
          </CardContent>
        </Card>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {activeTab === 'reports' ? (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Products</CardTitle>
              <CardDescription>
                The products your technicians use. They pick one on a report and its active
                ingredient, HSE/MAPP number and safety sheet are filled in for them. Editing this
                list never changes a report that has already been written.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProductListEditor
                products={form.products}
                onChange={(products) => set('products', products)}
              />
              <div className="mt-6">
                <SaveBar saving={saving} dirty={dirty} onSave={() => void save()} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Report wording</CardTitle>
              <CardDescription>
                Printed on every inspection report. Safety advice only appears when that kind of
                product was used. Leave a box empty to leave it off.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Field
                label="Safety advice: insecticides"
                htmlFor="report_insecticide_guidance"
                hint="One point per line."
              >
                <Textarea
                  id="report_insecticide_guidance"
                  rows={6}
                  value={form.report_insecticide_guidance}
                  onChange={(event) => set('report_insecticide_guidance', event.target.value)}
                />
              </Field>

              <Field
                label="Safety advice: rodenticides"
                htmlFor="report_rodenticide_guidance"
                hint="One point per line."
              >
                <Textarea
                  id="report_rodenticide_guidance"
                  rows={6}
                  value={form.report_rodenticide_guidance}
                  onChange={(event) => set('report_rodenticide_guidance', event.target.value)}
                />
              </Field>

              <Field
                label="Declaration"
                htmlFor="report_declaration"
                hint="Printed above the signatures."
              >
                <Textarea
                  id="report_declaration"
                  rows={5}
                  value={form.report_declaration}
                  onChange={(event) => set('report_declaration', event.target.value)}
                />
              </Field>

              <SaveBar saving={saving} dirty={dirty} onSave={() => void save()} />
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {activeTab === 'email' ? (
        <EmailSettings
          form={form}
          set={set}
          settings={settings}
          saving={saving}
          dirty={dirty}
          onSave={save}
          SaveBar={SaveBar}
        />
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
