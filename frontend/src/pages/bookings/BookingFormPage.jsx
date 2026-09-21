import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  AlertCircle,
  ArrowLeft,
  CalendarClock,
  Save,
  Search,
} from 'lucide-react'

import { listCustomers } from '@/api/customers'
import { getQuote, listQuotes } from '@/api/quotes'
import {
  createBooking,
  createBookingFromQuote,
  getBooking,
  updateBooking,
} from '@/api/bookings'
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
import { LoadingState, Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { toastError, toastSuccess } from '@/components/ui/use-toast'
import { useTechnicians } from '@/hooks/useBookings'
import { toApiError } from '@/lib/api'
import {
  addMinutesToInputValue,
  cn,
  formatCurrency,
  formatDuration,
  fromDateTimeInputValue,
  minutesBetween,
  toDateTimeInputValue,
} from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import {
  DEFAULT_BOOKING_DURATION_MINUTES,
  EDITABLE_BOOKING_STATUSES,
  pestOptions,
  QuoteStatus,
  RECURRENCE_TYPES,
  SERVICE_TYPES,
  UserRole,
} from '@/lib/constants'

const DEFAULT_SERVICE_TYPE = 'General Pest Control'
const NONE = ''

const SELECT_CLASSES =
  'flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60'

const bookingSchema = z
  .object({
    customer_id: z.string().trim().min(1, 'Select a customer'),
    quote_id: z.string().trim(),
    technician_id: z.string().trim(),
    service_type: z.string().trim().min(1, 'Select a service type'),
    pest_types: z.array(z.string()),
    scheduled_start: z.string().trim().min(1, 'Choose a start time'),
    scheduled_end: z.string().trim().min(1, 'Choose an end time'),
    estimated_duration_minutes: z.coerce
      .number({ invalid_type_error: 'Enter a duration' })
      .int('Use whole minutes')
      .min(5, 'At least 5 minutes')
      .max(1440, 'At most 24 hours'),
    recurrence: z.string().trim(),
    quoted_amount: z.union([z.literal(''), z.coerce.number().min(0, 'Cannot be negative')]),
    customer_notes: z.string().trim().max(5000),
    technician_notes: z.string().trim().max(5000),
    internal_notes: z.string().trim().max(5000),
    site_contact_name: z.string().trim().max(120),
    site_contact_phone: z.string().trim().max(40),
    order_number: z.string().trim().max(60),
  })
  .refine(
    (values) =>
      !values.scheduled_start ||
      !values.scheduled_end ||
      new Date(values.scheduled_end) > new Date(values.scheduled_start),
    { message: 'The end time must be after the start time', path: ['scheduled_end'] },
  )

/** Next round hour, as a datetime-local value. */
function defaultStart() {
  const date = new Date()
  date.setHours(date.getHours() + 1, 0, 0, 0)
  return toDateTimeInputValue(date)
}

/** Union of the known options and whatever value the record already holds. */
function optionsWith(list, value) {
  if (!value || list.includes(value)) return list
  return [...list, value]
}

export function BookingFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isEdit = Boolean(id)
  const user = useAuthStore((state) => state.user)
  const isTechnician = user?.role === UserRole.TECHNICIAN

  const quoteIdParam = searchParams.get('quote_id') ?? ''
  const customerIdParam = searchParams.get('customer_id') ?? ''

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [submitError, setSubmitError] = useState(null)
  const [customers, setCustomers] = useState([])
  const [customerSearch, setCustomerSearch] = useState('')
  const [quotes, setQuotes] = useState([])
  const [quotesLoading, setQuotesLoading] = useState(false)
  /** Quote id the booking was originally created from (edit mode). */
  const [lockedQuoteId, setLockedQuoteId] = useState('')

  const { technicians } = useTechnicians(true)

  const startValue = defaultStart()

  const form = useForm({
    resolver: zodResolver(bookingSchema),
    defaultValues: {
      customer_id: customerIdParam,
      quote_id: quoteIdParam,
      technician_id: NONE,
      service_type: DEFAULT_SERVICE_TYPE,
      pest_types: [],
      scheduled_start: startValue,
      scheduled_end: addMinutesToInputValue(startValue, DEFAULT_BOOKING_DURATION_MINUTES),
      estimated_duration_minutes: DEFAULT_BOOKING_DURATION_MINUTES,
      recurrence: 'none',
      quoted_amount: '',
      customer_notes: '',
      technician_notes: '',
      internal_notes: '',
      site_contact_name: '',
      site_contact_phone: '',
      order_number: '',
    },
    mode: 'onBlur',
  })

  const { control, reset, setValue, getValues } = form

  const selectedCustomerId = useWatch({ control, name: 'customer_id' })
  const selectedQuoteId = useWatch({ control, name: 'quote_id' })
  const selectedPestTypes = useWatch({ control, name: 'pest_types' }) ?? []
  const watchedStart = useWatch({ control, name: 'scheduled_start' })
  const watchedEnd = useWatch({ control, name: 'scheduled_end' })
  const watchedServiceType = useWatch({ control, name: 'service_type' })

  /** Apply a quote's details onto the form. */
  const applyQuote = useCallback(
    (quote) => {
      if (!quote) return
      const firstServiceType = quote.items?.find((item) => item.service_type)?.service_type
      const pestTypes = []
      const seen = new Set()
      for (const item of quote.items ?? []) {
        const pest = item.pest_type?.trim()
        if (!pest) continue
        const key = pest.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        pestTypes.push(pest)
      }

      setValue('customer_id', quote.customer_id, { shouldDirty: true })
      setValue('quote_id', quote.id, { shouldDirty: true })
      setValue('service_type', firstServiceType || DEFAULT_SERVICE_TYPE, { shouldDirty: true })
      setValue('pest_types', pestTypes, { shouldDirty: true })
      setValue('quoted_amount', quote.total ?? '', { shouldDirty: true })
    },
    [setValue],
  )

  // Initial load: customers, plus either the booking being edited or the quote
  // named in the URL.
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
          const booking = await getBooking(id)
          if (cancelled) return

          if (!EDITABLE_BOOKING_STATUSES.includes(booking.status)) {
            setLoadError('Only scheduled or confirmed jobs can be edited.')
            return
          }

          setLockedQuoteId(booking.quote_id ?? '')
          reset({
            customer_id: booking.customer_id,
            quote_id: booking.quote_id ?? NONE,
            technician_id: booking.technician_id ?? NONE,
            service_type: booking.service_type || DEFAULT_SERVICE_TYPE,
            pest_types: booking.pest_types ?? [],
            scheduled_start: toDateTimeInputValue(booking.scheduled_start),
            scheduled_end: toDateTimeInputValue(booking.scheduled_end),
            estimated_duration_minutes:
              booking.estimated_duration_minutes || DEFAULT_BOOKING_DURATION_MINUTES,
            recurrence: booking.recurrence ?? 'none',
            quoted_amount: booking.quoted_amount ?? '',
            customer_notes: booking.customer_notes ?? '',
            technician_notes: booking.technician_notes ?? '',
            internal_notes: booking.internal_notes ?? '',
            site_contact_name: booking.site_contact_name ?? '',
            site_contact_phone: booking.site_contact_phone ?? '',
            order_number: booking.order_number ?? '',
          })
        } else if (quoteIdParam) {
          const quote = await getQuote(quoteIdParam)
          if (cancelled) return
          applyQuote(quote)
        }
      } catch (err) {
        if (!cancelled) setLoadError(toApiError(err, 'Could not open the job form').message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [id, quoteIdParam, reset, applyQuote])

  // Load convertible quotes whenever the selected customer changes.
  useEffect(() => {
    let cancelled = false

    async function loadQuotes() {
      if (!selectedCustomerId) {
        setQuotes([])
        return
      }

      setQuotesLoading(true)
      try {
        const data = await listQuotes({
          page: 1,
          page_size: 100,
          customer_id: selectedCustomerId,
          status: QuoteStatus.ACCEPTED,
        })
        if (cancelled) return
        // Only quotes that have not been turned into a booking yet, plus the
        // one this booking is already linked to.
        setQuotes(
          data.items.filter(
            (quote) => !quote.converted_to_booking || quote.id === lockedQuoteId,
          ),
        )
      } catch {
        if (!cancelled) setQuotes([])
      } finally {
        if (!cancelled) setQuotesLoading(false)
      }
    }

    void loadQuotes()
    return () => {
      cancelled = true
    }
  }, [selectedCustomerId, lockedQuoteId])

  const filteredCustomers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase()
    if (!term) return customers
    return customers.filter((customer) =>
      `${customer.first_name} ${customer.last_name}`.toLowerCase().includes(term),
    )
  }, [customers, customerSearch])

  const liveDuration = useMemo(
    () => minutesBetween(watchedStart, watchedEnd),
    [watchedStart, watchedEnd],
  )

  /** Pest checkboxes, including any legacy value already on the record. */
  const pestTypeOptions = useMemo(() => pestOptions(selectedPestTypes ?? []), [selectedPestTypes])

  /** Start or duration changed -> recompute the end time. */
  function syncEnd(start, minutes) {
    const nextEnd = addMinutesToInputValue(start, minutes)
    if (nextEnd) setValue('scheduled_end', nextEnd, { shouldValidate: true })
  }

  function handleStartChange(value) {
    setValue('scheduled_start', value, { shouldValidate: true, shouldDirty: true })
    syncEnd(value, getValues('estimated_duration_minutes'))
  }

  function handleDurationChange(value) {
    setValue('estimated_duration_minutes', value, { shouldValidate: true, shouldDirty: true })
    const minutes = Number(value)
    if (Number.isFinite(minutes) && minutes > 0) {
      syncEnd(getValues('scheduled_start'), minutes)
    }
  }

  /** Editing the end directly keeps the duration honest. */
  function handleEndChange(value) {
    setValue('scheduled_end', value, { shouldValidate: true, shouldDirty: true })
    const minutes = minutesBetween(getValues('scheduled_start'), value)
    if (minutes >= 5) {
      setValue('estimated_duration_minutes', minutes, { shouldValidate: true })
    }
  }

  async function handleQuoteChange(nextQuoteId) {
    setValue('quote_id', nextQuoteId, { shouldDirty: true })
    if (!nextQuoteId) return

    const inList = quotes.find((quote) => quote.id === nextQuoteId)
    try {
      const quote = inList ?? (await getQuote(nextQuoteId))
      applyQuote(quote)
    } catch (err) {
      toastError('Could not load quote', toApiError(err).message)
    }
  }

  function togglePestType(pest) {
    const current = getValues('pest_types') ?? []
    const next = current.includes(pest)
      ? current.filter((item) => item !== pest)
      : [...current, pest]
    setValue('pest_types', next, { shouldDirty: true })
  }

  function toPayload(values) {
    const payload = {
      customer_id: values.customer_id,
      technician_id: values.technician_id || null,
      scheduled_start: fromDateTimeInputValue(values.scheduled_start),
      scheduled_end: fromDateTimeInputValue(values.scheduled_end),
      service_type: values.service_type,
      pest_types: values.pest_types ?? [],
      recurrence: values.recurrence || 'none',
      estimated_duration_minutes: Number(values.estimated_duration_minutes),
      quoted_amount: values.quoted_amount === '' ? null : Number(values.quoted_amount),
      customer_notes: values.customer_notes === '' ? null : values.customer_notes,
      technician_notes: values.technician_notes === '' ? null : values.technician_notes,
      site_contact_name: values.site_contact_name || null,
      site_contact_phone: values.site_contact_phone || null,
      order_number: values.order_number || null,
    }

    if (!isTechnician) {
      payload.internal_notes = values.internal_notes === '' ? null : values.internal_notes
    }

    return payload
  }

  async function onSubmit(values) {
    setSubmitError(null)
    const payload = toPayload(values)

    try {
      if (isEdit && id) {
        const updated = await updateBooking(id, { ...payload, quote_id: values.quote_id || null })
        toastSuccess('Job updated', `${updated.booking_number} was saved.`)
        navigate(`/bookings/${id}`)
        return
      }

      let created
      if (values.quote_id) {
        // Converting an accepted quote keeps the quote and booking in sync.
        const { customer_id: _customerId, ...conversionPayload } = payload
        created = await createBookingFromQuote(values.quote_id, conversionPayload)
      } else {
        created = await createBooking(payload)
      }

      toastSuccess('Job booked', `${created.booking_number} has been scheduled.`)
      navigate(`/bookings/${created.id}`)
    } catch (err) {
      const apiError = toApiError(err, 'Could not save this job')
      setSubmitError(apiError.message)
      toastError('Save failed', apiError.message)
    }
  }

  if (loading) {
    return <LoadingState message="Loading..." />
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" className="-ml-2" onClick={() => navigate('/bookings')}>
          <ArrowLeft className="h-4 w-4" />
          Back to jobs
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <p className="font-medium text-foreground">
              Could not open this booking
            </p>
            <p className="text-sm text-muted-foreground">{loadError}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const submitting = form.formState.isSubmitting
  const serviceTypeOptions = optionsWith(SERVICE_TYPES, watchedServiceType)

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={isEdit && id ? `/bookings/${id}` : '/bookings'}
        backLabel={isEdit ? 'Back to job' : 'Back to jobs'}
        title={isEdit ? 'Edit job' : 'Book a job'}
        description={isEdit
        ? 'Update the schedule, assignment and service details for this job.'
        : 'Book a job, assign a technician and capture the on-site details.'}
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
              <CardTitle>Customer &amp; quote</CardTitle>
              <CardDescription>
                Who the job is for, who will be on site, and the quote it came from.
              </CardDescription>
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

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={control}
                  name="customer_id"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormLabel>Customer *</FormLabel>
                      <FormControl>
                        <select
                          {...field}
                          className={SELECT_CLASSES}
                          aria-invalid={Boolean(fieldState.error) || undefined}
                          onChange={(event) => {
                            field.onChange(event)
                            setValue('quote_id', NONE, { shouldDirty: true })
                          }}
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

                <FormField
                  control={control}
                  name="quote_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Quote (optional)</FormLabel>
                      <FormControl>
                        <select
                          {...field}
                          className={SELECT_CLASSES}
                          disabled={!selectedCustomerId || quotesLoading}
                          onChange={(event) => void handleQuoteChange(event.target.value)}
                        >
                          <option value="">No quote</option>
                          {quotes.map((quote) => (
                            <option key={quote.id} value={quote.id}>
                              {quote.quote_number} - {formatCurrency(quote.total)}
                            </option>
                          ))}
                        </select>
                      </FormControl>
                      <FormDescription>
                        {!selectedCustomerId
                          ? 'Pick a customer first.'
                          : quotesLoading
                            ? 'Loading quotes...'
                            : quotes.length === 0
                              ? 'No accepted quotes waiting to be converted.'
                              : 'Selecting a quote fills in the service details below.'}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <FormField
                  control={control}
                  name="site_contact_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Site contact</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g. the tenant" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={control}
                  name="site_contact_phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Site contact phone</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="07700 900123" type="tel" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={control}
                  name="order_number"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Customer order no.</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Purchase order, if they use one" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Schedule</CardTitle>
              <CardDescription>
                The end time follows the start time and estimated duration.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 lg:grid-cols-3">
                <FormField
                  control={control}
                  name="scheduled_start"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormLabel>Scheduled start *</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="datetime-local"
                          hasError={Boolean(fieldState.error)}
                          onChange={(event) => handleStartChange(event.target.value)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={control}
                  name="estimated_duration_minutes"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormLabel>Estimated duration (minutes) *</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          min="5"
                          max="1440"
                          step="5"
                          inputMode="numeric"
                          hasError={Boolean(fieldState.error)}
                          onChange={(event) => handleDurationChange(event.target.value)}
                        />
                      </FormControl>
                      <FormDescription>Defaults to 60 minutes.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={control}
                  name="scheduled_end"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormLabel>Scheduled end *</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="datetime-local"
                          hasError={Boolean(fieldState.error)}
                          onChange={(event) => handleEndChange(event.target.value)}
                        />
                      </FormControl>
                      <FormDescription>
                        Booked length: {formatDuration(liveDuration)}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={control}
                  name="technician_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Technician (optional)</FormLabel>
                      <FormControl>
                        <select {...field} className={SELECT_CLASSES}>
                          <option value="">Unassigned</option>
                          {technicians.map((technician) => (
                            <option key={technician.id} value={technician.id}>
                              {technician.full_name}
                            </option>
                          ))}
                        </select>
                      </FormControl>
                      <FormDescription>
                        {technicians.length} technician{technicians.length === 1 ? '' : 's'}{' '}
                        available.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={control}
                  name="recurrence"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Recurrence</FormLabel>
                      <FormControl>
                        <select {...field} className={SELECT_CLASSES}>
                          {Object.entries(RECURRENCE_TYPES).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Service details</CardTitle>
              <CardDescription>What is being treated, and what it is worth.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={control}
                  name="service_type"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormLabel>Service type *</FormLabel>
                      <FormControl>
                        <select
                          {...field}
                          className={SELECT_CLASSES}
                          aria-invalid={Boolean(fieldState.error) || undefined}
                        >
                          <option value="">Select a service type</option>
                          {serviceTypeOptions.map((service) => (
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
                  name="quoted_amount"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormLabel>Quoted amount (GBP)</FormLabel>
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
                      <FormDescription>
                        {selectedQuoteId
                          ? 'Pre-filled from the selected quote.'
                          : 'Leave blank if there is no agreed price yet.'}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={control}
                name="pest_types"
                render={() => (
                  <FormItem>
                    <FormLabel>Pest types</FormLabel>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                      {pestTypeOptions.map((pest) => {
                        const checked = selectedPestTypes.includes(pest)
                        return (
                          <label
                            key={pest}
                            className={cn(
                              'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
                              checked
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-input text-foreground hover:bg-muted/50',
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => togglePestType(pest)}
                              className="h-4 w-4 rounded border-input text-primary focus:ring-ring"
                            />
                            <span className="truncate">{pest}</span>
                          </label>
                        )
                      })}
                    </div>
                    <FormDescription>
                      {selectedPestTypes.length === 0
                        ? 'Select every pest this job covers.'
                        : `${selectedPestTypes.length} selected.`}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
              <CardDescription>
                Instructions for the customer and the technician, plus anything the office needs to
                remember.
              </CardDescription>
            </CardHeader>
            <CardContent
              className={cn('grid gap-5', isTechnician ? 'sm:grid-cols-2' : 'lg:grid-cols-3')}
            >
              <FormField
                control={control}
                name="customer_notes"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Customer instructions</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={5}
                        placeholder="Please secure pets before the technician arrives."
                        hasError={Boolean(fieldState.error)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={control}
                name="technician_notes"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Technician notes</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={5}
                        placeholder="Roof cavity access is via the garage."
                        hasError={Boolean(fieldState.error)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {!isTechnician ? (
                <FormField
                  control={control}
                  name="internal_notes"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormLabel>Internal notes (office only)</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          rows={5}
                          placeholder="Account on hold until the deposit clears."
                          hasError={Boolean(fieldState.error)}
                        />
                      </FormControl>
                      <FormDescription>Never shown to technicians.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}
            </CardContent>
          </Card>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => navigate(isEdit && id ? `/bookings/${id}` : '/bookings')}
            >
              Cancel
            </Button>

            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <Spinner size="sm" className="text-current" />
              ) : isEdit ? (
                <Save className="h-4 w-4" />
              ) : (
                <CalendarClock className="h-4 w-4" />
              )}
              {isEdit ? 'Save job' : 'Book job'}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  )
}

export default BookingFormPage
