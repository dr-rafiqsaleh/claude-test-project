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
import { createInvoice, getInvoice, updateInvoice, updateInvoiceStatus } from '@/api/invoices'
import { listJobs } from '@/api/jobs'
import { listQuotes } from '@/api/quotes'
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
  DEFAULT_INVOICE_TERMS,
  DEFAULT_INVOICE_TERM_DAYS,
  DEFAULT_PAYMENT_INSTRUCTIONS,
  EDITABLE_INVOICE_STATUSES,
  INVOICE_STATUS,
  JOB_STATUS,
  QuoteStatus,
} from '@/lib/constants'

const itemSchema = z.object({
  description: z.string().trim().min(1, 'Description is required').max(300),
  quantity: z.coerce
    .number({ invalid_type_error: 'Enter a quantity' })
    .positive('Must be more than 0'),
  unit_price: z.coerce
    .number({ invalid_type_error: 'Enter a price' })
    .min(0, 'Cannot be negative'),
  tax_rate_percent: z.coerce
    .number({ invalid_type_error: 'Enter a tax rate' })
    .min(0, 'Cannot be negative')
    .max(100, 'Cannot exceed 100%'),
})

const invoiceSchema = z
  .object({
    customer_id: z.string().trim().min(1, 'Select a customer'),
    job_id: z.string().trim(),
    quote_id: z.string().trim(),
    issue_date: z.string().trim().min(1, 'An issue date is required'),
    due_date: z.string().trim().min(1, 'A due date is required'),
    items: z.array(itemSchema).min(1, 'Add at least one line item'),
    notes: z.string().trim().max(5000),
    terms: z.string().trim().max(5000),
    payment_instructions: z.string().trim().max(5000),
  })
  .refine((values) => !values.due_date || values.due_date >= values.issue_date, {
    message: 'The due date must fall on or after the issue date',
    path: ['due_date'],
  })

function emptyItem() {
  return { description: '', quantity: 1, unit_price: '', tax_rate_percent: 20 }
}

function lineTotals(items) {
  let subtotal = 0
  let tax = 0

  for (const item of items ?? []) {
    const quantity = Number(item?.quantity)
    const price = Number(item?.unit_price)
    const rate = Number(item?.tax_rate_percent)
    if (!Number.isFinite(quantity) || !Number.isFinite(price)) continue

    const line = Math.round(quantity * price * 100) / 100
    subtotal += line
    tax += Math.round(line * (Number.isFinite(rate) ? rate / 100 : 0) * 100) / 100
  }

  const roundedSubtotal = Math.round(subtotal * 100) / 100
  const roundedTax = Math.round(tax * 100) / 100
  return {
    subtotal: roundedSubtotal,
    taxAmount: roundedTax,
    total: Math.round((roundedSubtotal + roundedTax) * 100) / 100,
  }
}

export function InvoiceFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isEdit = Boolean(id)

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [submitError, setSubmitError] = useState(null)
  const [customers, setCustomers] = useState([])
  const [customerSearch, setCustomerSearch] = useState('')
  const [jobs, setJobs] = useState([])
  const [quotes, setQuotes] = useState([])
  const [relatedLoading, setRelatedLoading] = useState(false)
  const [sendAfterSave, setSendAfterSave] = useState(false)

  const form = useForm({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      customer_id: searchParams.get('customer_id') ?? '',
      job_id: searchParams.get('job_id') ?? '',
      quote_id: '',
      issue_date: toDateInputValue(new Date()),
      due_date: addDaysToToday(DEFAULT_INVOICE_TERM_DAYS),
      items: [emptyItem()],
      notes: '',
      terms: DEFAULT_INVOICE_TERMS,
      payment_instructions: DEFAULT_PAYMENT_INSTRUCTIONS,
    },
    mode: 'onBlur',
  })

  const { control, reset, setValue, getValues } = form
  const { fields, append, remove, replace } = useFieldArray({ control, name: 'items' })

  const watchedItems = useWatch({ control, name: 'items' }) ?? []
  const selectedCustomerId = useWatch({ control, name: 'customer_id' })

  const totals = useMemo(() => lineTotals(watchedItems), [watchedItems])

  // Load the customer list (and the invoice itself when editing).
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
          const invoice = await getInvoice(id)
          if (cancelled) return

          if (!EDITABLE_INVOICE_STATUSES.includes(invoice.status)) {
            setLoadError('Only draft or sent invoices can be edited.')
            return
          }

          reset({
            customer_id: invoice.customer_id,
            job_id: invoice.job_id ?? '',
            quote_id: invoice.quote_id ?? '',
            issue_date: toDateInputValue(invoice.issue_date),
            due_date: toDateInputValue(invoice.due_date),
            items: (invoice.items ?? []).map((item) => ({
              description: item.description ?? '',
              quantity: item.quantity ?? 1,
              unit_price: item.unit_price ?? '',
              tax_rate_percent: Math.round((item.tax_rate ?? 0.2) * 10000) / 100,
            })),
            notes: invoice.notes ?? '',
            terms: invoice.terms ?? DEFAULT_INVOICE_TERMS,
            payment_instructions: invoice.payment_instructions ?? '',
          })
        }
      } catch (err) {
        if (!cancelled) setLoadError(toApiError(err, 'Could not load this invoice').message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [id, reset])

  // Load the completed jobs and accepted quotes belonging to the chosen customer.
  useEffect(() => {
    let cancelled = false

    if (!selectedCustomerId) {
      setJobs([])
      setQuotes([])
      return () => {
        cancelled = true
      }
    }

    async function loadRelated() {
      setRelatedLoading(true)
      const [jobResult, quoteResult] = await Promise.allSettled([
        listJobs({
          page: 1,
          page_size: 100,
          customer_id: selectedCustomerId,
          status: JOB_STATUS.COMPLETED,
        }),
        listQuotes({
          page: 1,
          page_size: 100,
          customer_id: selectedCustomerId,
          status: QuoteStatus.ACCEPTED,
        }),
      ])

      if (cancelled) return

      const currentJobId = getValues('job_id')
      setJobs(
        jobResult.status === 'fulfilled'
          ? // Keep the job already linked to this invoice in the list, even
            // though it now has an invoice id.
            jobResult.value.items.filter(
              (job) => !job.invoice_id || job.id === currentJobId,
            )
          : [],
      )
      setQuotes(quoteResult.status === 'fulfilled' ? quoteResult.value.items : [])
      setRelatedLoading(false)
    }

    void loadRelated()
    return () => {
      cancelled = true
    }
  }, [selectedCustomerId, getValues])

  const filteredCustomers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase()
    if (!term) return customers
    return customers.filter((customer) =>
      `${customer.first_name} ${customer.last_name}`.toLowerCase().includes(term),
    )
  }, [customers, customerSearch])

  /** Picking a job seeds a single service line item. */
  function handleJobChange(jobId) {
    setValue('job_id', jobId, { shouldDirty: true })
    if (!jobId) return

    const job = jobs.find((item) => item.id === jobId)
    if (!job) return

    const current = getValues('items') ?? []
    const isBlank =
      current.length === 1 && !String(current[0]?.description ?? '').trim() && !current[0]?.unit_price

    const seeded = {
      description: `Pest Control Services - ${job.service_type}`,
      quantity: 1,
      unit_price: job.quoted_amount ?? '',
      tax_rate_percent: 20,
    }

    if (isBlank) {
      replace([seeded])
    } else {
      append(seeded)
    }
  }

  /** Picking a quote copies its line items across. */
  function handleQuoteChange(quoteId) {
    setValue('quote_id', quoteId, { shouldDirty: true })
    if (!quoteId) return

    const quote = quotes.find((item) => item.id === quoteId)
    if (!quote || !(quote.items ?? []).length) return

    const taxPercent = Math.round((quote.tax_rate ?? 0.2) * 10000) / 100
    replace(
      quote.items.map((item) => ({
        description: item.description ?? '',
        quantity: item.quantity ?? 1,
        unit_price: item.unit_price ?? '',
        tax_rate_percent: taxPercent,
      })),
    )
  }

  function toPayload(values) {
    return {
      customer_id: values.customer_id,
      job_id: values.job_id || null,
      quote_id: values.quote_id || null,
      items: values.items.map((item) => ({
        description: item.description,
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
        tax_rate: Number(item.tax_rate_percent) / 100,
      })),
      issue_date: new Date(`${values.issue_date}T00:00:00`).toISOString(),
      due_date: new Date(`${values.due_date}T00:00:00`).toISOString(),
      notes: values.notes === '' ? null : values.notes,
      terms: values.terms === '' ? null : values.terms,
      payment_instructions:
        values.payment_instructions === '' ? null : values.payment_instructions,
    }
  }

  async function onSubmit(values) {
    setSubmitError(null)
    const payload = toPayload(values)
    const shouldSend = sendAfterSave

    try {
      if (isEdit && id) {
        // customer/job/quote links are fixed once the invoice exists.
        const updated = await updateInvoice(id, {
          items: payload.items,
          issue_date: payload.issue_date,
          due_date: payload.due_date,
          notes: payload.notes,
          terms: payload.terms,
          payment_instructions: payload.payment_instructions,
        })

        if (shouldSend && updated.status === INVOICE_STATUS.DRAFT) {
          await updateInvoiceStatus(id, INVOICE_STATUS.SENT)
        }

        toastSuccess(
          shouldSend ? 'Invoice sent' : 'Invoice updated',
          `${updated.invoice_number} was saved.`,
        )
        navigate(`/invoices/${id}`)
      } else {
        const created = await createInvoice({
          ...payload,
          status: shouldSend ? INVOICE_STATUS.SENT : INVOICE_STATUS.DRAFT,
        })
        toastSuccess(
          shouldSend ? 'Invoice sent' : 'Invoice created',
          `${created.invoice_number} was ${
            shouldSend ? 'created and marked as sent' : 'saved as a draft'
          }.`,
        )
        navigate(`/invoices/${created.id}`)
      }
    } catch (err) {
      const apiError = toApiError(err, 'Could not save this invoice')
      setSubmitError(apiError.message)
      toastError('Save failed', apiError.message)
    } finally {
      setSendAfterSave(false)
    }
  }

  if (loading) {
    return <LoadingState message="Loading invoice form..." />
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" className="-ml-2" onClick={() => navigate('/invoices')}>
          <ArrowLeft className="h-4 w-4" />
          Back to invoices
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <p className="font-medium text-foreground">
              Could not open this invoice
            </p>
            <p className="text-sm text-muted-foreground">{loadError}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const submitting = form.formState.isSubmitting
  const itemsError = form.formState.errors.items?.message
  const selectClasses =
    'flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:bg-muted/50 disabled:opacity-60'

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={isEdit && id ? `/invoices/${id}` : '/invoices'}
        backLabel={isEdit ? 'Back to invoice' : 'Back to invoices'}
        title={isEdit ? 'Edit invoice' : 'New invoice'}
        description={isEdit
        ? 'Update the line items and details on this invoice.'
        : 'Bill a customer for completed work, then save it as a draft or send it straight away.'}
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
          {/* Customer, job and quote ------------------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle>Bill to</CardTitle>
              <CardDescription>
                Who this invoice is for, and the work it covers.
                {isEdit ? ' These links are fixed once an invoice exists.' : ''}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isEdit ? (
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
              ) : null}

              <FormField
                control={control}
                name="customer_id"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Customer *</FormLabel>
                    <FormControl>
                      <select
                        {...field}
                        disabled={isEdit}
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
                      {customers.length} active customer{customers.length === 1 ? '' : 's'}{' '}
                      available.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={control}
                  name="job_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Job report (optional)</FormLabel>
                      <FormControl>
                        <select
                          {...field}
                          disabled={isEdit || !selectedCustomerId || relatedLoading}
                          className={selectClasses}
                          onChange={(event) => handleJobChange(event.target.value)}
                        >
                          <option value="">No linked job</option>
                          {jobs.map((job) => (
                            <option key={job.id} value={job.id}>
                              {job.job_number} - {job.service_type}
                            </option>
                          ))}
                        </select>
                      </FormControl>
                      <FormDescription>
                        {selectedCustomerId
                          ? `${jobs.length} completed job(s) awaiting an invoice.`
                          : 'Choose a customer first.'}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={control}
                  name="quote_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Quote (optional)</FormLabel>
                      <FormControl>
                        <select
                          {...field}
                          disabled={isEdit || !selectedCustomerId || relatedLoading}
                          className={selectClasses}
                          onChange={(event) => handleQuoteChange(event.target.value)}
                        >
                          <option value="">No linked quote</option>
                          {quotes.map((quote) => (
                            <option key={quote.id} value={quote.id}>
                              {quote.quote_number} - {formatCurrency(quote.total)}
                            </option>
                          ))}
                        </select>
                      </FormControl>
                      <FormDescription>
                        {selectedCustomerId
                          ? 'Selecting a quote copies its line items across.'
                          : 'Choose a customer first.'}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          {/* Dates -------------------------------------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle>Dates</CardTitle>
              <CardDescription>
                When the invoice was raised, and when payment is expected.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <FormField
                control={control}
                name="issue_date"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Issue date *</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" hasError={Boolean(fieldState.error)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={control}
                name="due_date"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Due date *</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" hasError={Boolean(fieldState.error)} />
                    </FormControl>
                    <FormDescription>
                      Defaults to {DEFAULT_INVOICE_TERM_DAYS} days from today.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Line items --------------------------------------------------- */}
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Line items</CardTitle>
                  <CardDescription>Each service or product being billed.</CardDescription>
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
                const rate = Number(watchedItems[index]?.tax_rate_percent)
                const line =
                  Number.isFinite(quantity) && Number.isFinite(price) ? quantity * price : 0
                const lineTotal = line + line * (Number.isFinite(rate) ? rate / 100 : 0)

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

                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <FormField
                        control={control}
                        name={`items.${index}.description`}
                        render={({ field, fieldState }) => (
                          <FormItem className="sm:col-span-2 lg:col-span-4">
                            <FormLabel>Description *</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="Pest Control Services - General Pest Control"
                                hasError={Boolean(fieldState.error)}
                              />
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
                                placeholder="280.00"
                                hasError={Boolean(fieldState.error)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={control}
                        name={`items.${index}.tax_rate_percent`}
                        render={({ field, fieldState }) => (
                          <FormItem>
                            <FormLabel>Tax rate (%) *</FormLabel>
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
                            <FormDescription>UK VAT is 20%.</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormItem>
                        <FormLabel>Line total (inc. VAT)</FormLabel>
                        <div className="flex h-10 items-center rounded-md border border-dashed border-input px-3 text-sm font-medium text-foreground">
                          {formatCurrency(lineTotal)}
                        </div>
                      </FormItem>
                    </div>
                  </div>
                )
              })}

              <div className="rounded-lg border border-border bg-muted/50 p-4">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Live totals
                </Label>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Subtotal</dt>
                    <dd className="font-medium text-foreground">
                      {formatCurrency(totals.subtotal)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">VAT</dt>
                    <dd className="font-medium text-foreground">
                      {formatCurrency(totals.taxAmount)}
                    </dd>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-base">
                    <dt className="font-semibold text-foreground">Total due</dt>
                    <dd className="font-semibold text-primary">
                      {formatCurrency(totals.total)}
                    </dd>
                  </div>
                </dl>
              </div>
            </CardContent>
          </Card>

          {/* Notes, terms, payment instructions --------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle>Notes, terms &amp; payment</CardTitle>
              <CardDescription>
                What the customer should know, and how they can pay you.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-5 sm:grid-cols-2">
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
                          placeholder="Quarterly general pest treatment - internal and external."
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
              </div>

              <FormField
                control={control}
                name="payment_instructions"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Payment instructions</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={3}
                        placeholder="Sort Code: 20-00-00  Account No: 12345678  Account Name: QKil Pest Control Ltd"
                        hasError={Boolean(fieldState.error)}
                      />
                    </FormControl>
                    <FormDescription>Printed in a box at the foot of the PDF.</FormDescription>
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
              onClick={() => navigate(isEdit && id ? `/invoices/${id}` : '/invoices')}
            >
              Cancel
            </Button>

            <Button
              type="submit"
              variant="outline"
              disabled={submitting}
              onClick={() => setSendAfterSave(false)}
            >
              {submitting && !sendAfterSave ? <Spinner size="sm" /> : <Save className="h-4 w-4" />}
              {isEdit ? 'Save changes' : 'Save as draft'}
            </Button>

            <Button type="submit" disabled={submitting} onClick={() => setSendAfterSave(true)}>
              {submitting && sendAfterSave ? (
                <Spinner size="sm" className="text-current" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Save and send
            </Button>
          </div>
        </form>
      </Form>
    </div>
  )
}

export default InvoiceFormPage
