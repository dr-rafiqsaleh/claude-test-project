import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  AlertCircle,
  ArrowLeft,
  Plus,
  Save,
  Search,
  Send,
  Trash2,
} from 'lucide-react'

import { listCustomers } from '@/api/customers'
import { createQuote, getQuote, updateQuote } from '@/api/quotes'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { LoadingState, Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { toastError, toastSuccess } from '@/components/ui/use-toast'
import { toApiError } from '@/lib/api'
import { addDaysToToday, formatCurrency, toDateInputValue } from '@/lib/utils'
import {
  DEFAULT_QUOTE_TERMS,
  QUOTE_PEST_TYPES,
  QUOTE_SERVICE_TYPES,
  QUOTE_UNITS,
  QuoteStatus,
  toPercent,
} from '@/lib/constants'
import { useCompanySettings } from '@/hooks/useCompanySettings'

const itemSchema = z.object({
  description: z.string().trim().min(1, 'Description is required').max(300),
  pest_type: z.string().trim().min(1, 'Pest type is required'),
  service_type: z.string().trim().min(1, 'Service type is required'),
  quantity: z.coerce.number({ invalid_type_error: 'Enter a quantity' }).positive('Must be more than 0'),
  unit: z.string().trim().min(1, 'Unit is required'),
  unit_price: z.coerce
    .number({ invalid_type_error: 'Enter a price' })
    .positive('Unit price must be more than 0'),
})

const quoteSchema = z.object({
  customer_id: z.string().trim().min(1, 'Select a customer'),
  items: z.array(itemSchema).min(1, 'Add at least one line item'),
  tax_rate_percent: z.coerce
    .number({ invalid_type_error: 'Enter a tax rate' })
    .min(0, 'Cannot be negative')
    .max(100, 'Cannot exceed 100%'),
  valid_until: z.string().trim(),
  notes: z.string().trim().max(5000),
  terms: z.string().trim().max(5000),
})

function emptyItem() {
  return {
    description: '',
    pest_type: '',
    service_type: '',
    quantity: 1,
    unit: 'service',
    unit_price: '',
  }
}

export function QuoteFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isEdit = Boolean(id)

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [submitError, setSubmitError] = useState(null)
  const [customers, setCustomers] = useState([])
  const [customerSearch, setCustomerSearch] = useState('')
  const [sendAfterSave, setSendAfterSave] = useState(false)

  // VAT is only charged once the business is VAT registered (Settings).
  const settings = useCompanySettings()
  const vatRegistered = Boolean(settings?.vat_registered)

  const form = useForm({
    resolver: zodResolver(quoteSchema),
    defaultValues: {
      customer_id: searchParams.get('customer_id') ?? '',
      items: [emptyItem()],
      tax_rate_percent: 0,
      valid_until: addDaysToToday(30),
      notes: '',
      terms: DEFAULT_QUOTE_TERMS,
    },
    mode: 'onBlur',
  })

  const { control, reset, setValue, getFieldState } = form
  const { fields, append, remove } = useFieldArray({ control, name: 'items' })

  const watchedItems = useWatch({ control, name: 'items' }) ?? []
  const watchedTaxPercent = useWatch({ control, name: 'tax_rate_percent' })

  const totals = useMemo(() => {
    const subtotal = watchedItems.reduce((sum, item) => {
      const quantity = Number(item?.quantity)
      const price = Number(item?.unit_price)
      if (!Number.isFinite(quantity) || !Number.isFinite(price)) return sum
      return sum + Math.round(quantity * price * 100) / 100
    }, 0)

    const rate = Number(watchedTaxPercent)
    const taxRate = Number.isFinite(rate) ? rate / 100 : 0
    const taxAmount = Math.round(subtotal * taxRate * 100) / 100

    return {
      subtotal: Math.round(subtotal * 100) / 100,
      taxAmount,
      total: Math.round((subtotal + taxAmount) * 100) / 100,
    }
  }, [watchedItems, watchedTaxPercent])

  // An older quote may already carry VAT; it keeps showing it until saved.
  const showVat = vatRegistered || Number(watchedTaxPercent) > 0

  // A new quote takes its VAT rate, validity and terms from Settings.
  useEffect(() => {
    if (!settings || id) return
    if (!getFieldState('tax_rate_percent').isDirty) {
      setValue('tax_rate_percent', vatRegistered ? toPercent(settings.default_tax_rate ?? 0.2) : 0)
    }
    if (!getFieldState('valid_until').isDirty && settings.default_quote_valid_days) {
      setValue('valid_until', addDaysToToday(settings.default_quote_valid_days))
    }
    if (!getFieldState('terms').isDirty && settings.default_quote_terms) {
      setValue('terms', settings.default_quote_terms)
    }
  }, [settings, id, vatRegistered, getFieldState, setValue])

  // Load the customer list (and the quote itself when editing).
  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setLoadError(null)

      try {
        const customerData = await listCustomers({ page: 1, page_size: 200, is_active: true })
        if (cancelled) return
        setCustomers(customerData.items)

        if (id) {
          const quote = await getQuote(id)
          if (cancelled) return

          if (quote.status !== QuoteStatus.DRAFT) {
            setLoadError('Only draft quotes can be edited.')
            return
          }

          reset({
            customer_id: quote.customer_id,
            items: quote.items.map((item) => ({
              description: item.description ?? '',
              pest_type: item.pest_type ?? '',
              service_type: item.service_type ?? '',
              quantity: item.quantity ?? 1,
              unit: item.unit ?? 'service',
              unit_price: item.unit_price ?? '',
            })),
            tax_rate_percent: toPercent(quote.tax_rate),
            valid_until: toDateInputValue(quote.valid_until),
            notes: quote.notes ?? '',
            terms: quote.terms ?? DEFAULT_QUOTE_TERMS,
          })
        }
      } catch (err) {
        if (!cancelled) setLoadError(toApiError(err, 'Could not load this quote').message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [id, reset])

  const filteredCustomers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase()
    if (!term) return customers
    return customers.filter((customer) =>
      `${customer.first_name} ${customer.last_name}`.toLowerCase().includes(term),
    )
  }, [customers, customerSearch])

  function toPayload(values) {
    return {
      customer_id: values.customer_id,
      items: values.items.map((item) => ({
        description: item.description,
        pest_type: item.pest_type,
        service_type: item.service_type,
        quantity: Number(item.quantity),
        unit: item.unit,
        unit_price: Number(item.unit_price),
      })),
      tax_rate: Number(values.tax_rate_percent) / 100,
      valid_until: values.valid_until ? new Date(values.valid_until).toISOString() : null,
      notes: values.notes === '' ? null : values.notes,
      terms: values.terms === '' ? null : values.terms,
    }
  }

  async function onSubmit(values) {
    setSubmitError(null)
    const payload = toPayload(values)
    const shouldSend = sendAfterSave

    try {
      if (isEdit && id) {
        const updated = await updateQuote(id, payload)
        toastSuccess('Quote saved', `${updated.quote_number} was saved.`)
        // The quote page opens the email; sending it marks the quote sent.
        navigate(shouldSend ? `/quotes/${id}?email=1` : `/quotes/${id}`)
      } else {
        const created = await createQuote({ ...payload, status: QuoteStatus.DRAFT })
        toastSuccess('Quote saved', `${created.quote_number} was saved as a draft.`)
        navigate(shouldSend ? `/quotes/${created.id}?email=1` : `/quotes/${created.id}`)
      }
    } catch (err) {
      const apiError = toApiError(err, 'Could not save this quote')
      setSubmitError(apiError.message)
      toastError('Save failed', apiError.message)
    } finally {
      setSendAfterSave(false)
    }
  }

  if (loading) {
    return <LoadingState message="Loading quote form..." />
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" className="-ml-2" onClick={() => navigate('/quotes')}>
          <ArrowLeft className="h-4 w-4" />
          Back to quotes
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <p className="font-medium text-foreground">Could not open this quote</p>
            <p className="text-sm text-muted-foreground">{loadError}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const submitting = form.formState.isSubmitting
  const itemsError = form.formState.errors.items?.message
  const selectClasses =
    'flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60'

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={isEdit && id ? `/quotes/${id}` : '/quotes'}
        backLabel={isEdit ? 'Back to quote' : 'Back to quotes'}
        title={isEdit ? 'Edit quote' : 'New quote'}
        description={isEdit
        ? 'Update the line items and details on this draft quote.'
        : 'Build a quote for a customer, then save it as a draft or send it straight away.'}
      />

      {submitError ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{submitError}</span>
        </div>
      ) : null}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" noValidate>
          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
              <CardDescription>Who is this quote for?</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
                <Input
                  value={customerSearch}
                  onChange={(event) => setCustomerSearch(event.target.value)}
                  placeholder="Filter customers by name..."
                  className="pl-9"
                  aria-label="Filter customers"
                />
              </div>

              <FormField
                control={control}
                name="customer_id"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Customer *</FormLabel>
                    <FormControl>
                      <select
                        {...field}
                        className={selectClasses}
                        aria-invalid={Boolean(fieldState.error) || undefined}
                      >
                        <option value="">Select a customer</option>
                        {filteredCustomers.map((customer) => (
                          <option key={customer.id} value={customer.id}>
                            {customer.first_name} {customer.last_name}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormDescription>
                      {customers.length} active customer{customers.length === 1 ? '' : 's'} available.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Line items</CardTitle>
                  <CardDescription>Each service or treatment being quoted.</CardDescription>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => append(emptyItem())}>
                  <Plus className="h-4 w-4" />
                  Add item
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {itemsError ? (
                <p className="text-xs font-medium text-destructive">{itemsError}</p>
              ) : null}

              {fields.map((fieldItem, index) => {
                const quantity = Number(watchedItems[index]?.quantity)
                const price = Number(watchedItems[index]?.unit_price)
                const lineTotal =
                  Number.isFinite(quantity) && Number.isFinite(price) ? quantity * price : 0

                return (
                  <div
                    key={fieldItem.id}
                    className="rounded-lg border border-border p-4"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-sm font-semibold text-foreground">
                        Item {index + 1}
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={fields.length <= 1}
                        onClick={() => remove(index)}
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                        Remove
                      </Button>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <FormField
                        control={control}
                        name={`items.${index}.description`}
                        render={({ field, fieldState }) => (
                          <FormItem className="sm:col-span-2 lg:col-span-3">
                            <FormLabel>Description *</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="General pest treatment - internal and external"
                                hasError={Boolean(fieldState.error)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={control}
                        name={`items.${index}.pest_type`}
                        render={({ field, fieldState }) => (
                          <FormItem>
                            <FormLabel>Pest type *</FormLabel>
                            <FormControl>
                              <select
                                {...field}
                                className={selectClasses}
                                aria-invalid={Boolean(fieldState.error) || undefined}
                              >
                                <option value="">Select a pest type</option>
                                {QUOTE_PEST_TYPES.map((pest) => (
                                  <option key={pest} value={pest}>
                                    {pest}
                                  </option>
                                ))}
                              </select>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={control}
                        name={`items.${index}.service_type`}
                        render={({ field, fieldState }) => (
                          <FormItem>
                            <FormLabel>Service type *</FormLabel>
                            <FormControl>
                              <select
                                {...field}
                                className={selectClasses}
                                aria-invalid={Boolean(fieldState.error) || undefined}
                              >
                                <option value="">Select a service</option>
                                {QUOTE_SERVICE_TYPES.map((service) => (
                                  <option key={service} value={service}>
                                    {service}
                                  </option>
                                ))}
                              </select>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={control}
                        name={`items.${index}.unit`}
                        render={({ field, fieldState }) => (
                          <FormItem>
                            <FormLabel>Unit *</FormLabel>
                            <FormControl>
                              <select
                                {...field}
                                className={selectClasses}
                                aria-invalid={Boolean(fieldState.error) || undefined}
                              >
                                {QUOTE_UNITS.map((unit) => (
                                  <option key={unit} value={unit}>
                                    {unit}
                                  </option>
                                ))}
                              </select>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={control}
                        name={`items.${index}.quantity`}
                        render={({ field, fieldState }) => (
                          <FormItem>
                            <FormLabel>Quantity *</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                type="number"
                                min="0"
                                step="0.01"
                                inputMode="decimal"
                                hasError={Boolean(fieldState.error)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={control}
                        name={`items.${index}.unit_price`}
                        render={({ field, fieldState }) => (
                          <FormItem>
                            <FormLabel>Unit price (GBP) *</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                type="number"
                                min="0"
                                step="0.01"
                                inputMode="decimal"
                                placeholder="450.00"
                                hasError={Boolean(fieldState.error)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div className="space-y-1.5">
                        <Label>Line total</Label>
                        <div className="flex h-10 items-center rounded-md border border-dashed border-input px-3 text-sm font-medium text-foreground">
                          {formatCurrency(lineTotal)}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pricing &amp; validity</CardTitle>
              <CardDescription>
                {showVat ? 'VAT and how long this quote stands.' : 'How long this quote stands.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-5">
                {showVat ? (
                <FormField
                  control={control}
                  name="tax_rate_percent"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormLabel>VAT rate (%) *</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          inputMode="decimal"
                          hasError={Boolean(fieldState.error)}
                        />
                      </FormControl>
                      <FormDescription>
                        {vatRegistered
                          ? 'UK VAT is 20%.'
                          : 'VAT is switched off in Settings, so saving removes it.'}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                ) : null}

                <FormField
                  control={control}
                  name="valid_until"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormLabel>Valid until</FormLabel>
                      <FormControl>
                        <Input {...field} type="date" hasError={Boolean(fieldState.error)} />
                      </FormControl>
                      <FormDescription>Defaults to 30 days from today.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="rounded-lg border border-border bg-muted/50 p-4">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Live totals</Label>
                <dl className="mt-3 space-y-2 text-sm">
                  {showVat ? (
                    <>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Subtotal</dt>
                        <dd className="font-medium text-foreground">
                          {formatCurrency(totals.subtotal)}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">
                          VAT ({Number.isFinite(Number(watchedTaxPercent)) ? Number(watchedTaxPercent) : 0}%)
                        </dt>
                        <dd className="font-medium text-foreground">
                          {formatCurrency(totals.taxAmount)}
                        </dd>
                      </div>
                      <Separator />
                    </>
                  ) : null}
                  <div className="flex justify-between text-base">
                    <dt className="font-semibold text-foreground">Total</dt>
                    <dd className="font-semibold text-primary">
                      {formatCurrency(totals.total)}
                    </dd>
                  </div>
                </dl>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notes &amp; terms</CardTitle>
              <CardDescription>
                Anything the customer should know, plus your payment terms.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <FormField
                control={control}
                name="notes"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={5}
                        placeholder="Treatment scheduled outside business hours where possible."
                        hasError={Boolean(fieldState.error)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={control}
                name="terms"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Terms</FormLabel>
                    <FormControl>
                      <Textarea {...field} rows={5} hasError={Boolean(fieldState.error)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => navigate(isEdit && id ? `/quotes/${id}` : '/quotes')}
            >
              Cancel
            </Button>

            <Button
              type="submit"
              variant="outline"
              disabled={submitting}
              onClick={() => setSendAfterSave(false)}
            >
              {submitting && !sendAfterSave ? (
                <Spinner size="sm" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {isEdit ? 'Save draft' : 'Save as draft'}
            </Button>

            <Button type="submit" disabled={submitting} onClick={() => setSendAfterSave(true)}>
              {submitting && sendAfterSave ? (
                <Spinner size="sm" className="text-current" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Save and email
            </Button>
          </div>
        </form>
      </Form>
    </div>
  )
}

export default QuoteFormPage
