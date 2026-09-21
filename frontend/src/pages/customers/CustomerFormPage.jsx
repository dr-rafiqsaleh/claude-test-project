import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertCircle, ArrowLeft, Save } from 'lucide-react'

import { createCustomer, getCustomer, updateCustomer } from '@/api/customers'
import { Button } from '@/components/ui/button'
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
import { toApiError } from '@/lib/api'

const phoneRegex = /^[0-9+()\-\s]{6,20}$/

/** UK postcode, e.g. "SW1A 1AA", "OX1 2LJ", "M14 7HP". */
const postcodeRegex = /^[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}$/

const customerSchema = z.object({
  first_name: z.string().trim().min(1, 'First name is required').max(80),
  last_name: z.string().trim().min(1, 'Last name is required').max(80),
  email: z
    .string()
    .trim()
    .max(200)
    .refine((value) => value === '' || z.string().email().safeParse(value).success, {
      message: 'Enter a valid email address',
    }),
  phone: z
    .string()
    .trim()
    .min(1, 'Phone is required')
    .regex(phoneRegex, 'Enter a valid phone number'),
  mobile: z
    .string()
    .trim()
    .refine((value) => value === '' || phoneRegex.test(value), {
      message: 'Enter a valid mobile number',
    }),
  street: z.string().trim().min(1, 'Street is required').max(200),
  city: z.string().trim().min(1, 'Town / city is required').max(100),
  county: z.string().trim().max(60).optional(),
  postcode: z
    .string()
    .trim()
    .regex(postcodeRegex, 'Enter a valid UK postcode, e.g. SW1A 1AA'),
  country: z.string().trim().min(1, 'Country is required').max(60),
  notes: z.string().trim().max(5000),
})

const EMPTY_VALUES = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  mobile: '',
  street: '',
  city: '',
  county: '',
  postcode: '',
  country: 'United Kingdom',
  notes: '',
}

function toPayload(values) {
  return {
    first_name: values.first_name,
    last_name: values.last_name,
    email: values.email === '' ? null : values.email,
    phone: values.phone,
    mobile: values.mobile === '' ? null : values.mobile,
    address: {
      street: values.street,
      city: values.city,
      county: values.county === '' ? null : values.county,
      postcode: values.postcode,
      country: values.country,
    },
    notes: values.notes === '' ? null : values.notes,
  }
}

export function CustomerFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)

  const [loading, setLoading] = useState(isEdit)
  const [loadError, setLoadError] = useState(null)
  const [submitError, setSubmitError] = useState(null)

  const form = useForm({
    resolver: zodResolver(customerSchema),
    defaultValues: EMPTY_VALUES,
    mode: 'onBlur',
  })

  const { reset } = form

  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }

    let cancelled = false

    async function load(customerId) {
      setLoading(true)
      setLoadError(null)
      try {
        const customer = await getCustomer(customerId)
        if (cancelled) return
        reset({
          first_name: customer.first_name,
          last_name: customer.last_name,
          email: customer.email ?? '',
          phone: customer.phone,
          mobile: customer.mobile ?? '',
          street: customer.address.street,
          city: customer.address.city,
          county: customer.address.county ?? '',
          postcode: customer.address.postcode,
          country: customer.address.country ?? 'United Kingdom',
          notes: customer.notes ?? '',
        })
      } catch (err) {
        if (!cancelled) setLoadError(toApiError(err, 'Could not load this customer').message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load(id)
    return () => {
      cancelled = true
    }
  }, [id, reset])

  async function onSubmit(values) {
    setSubmitError(null)
    const payload = toPayload(values)

    try {
      if (isEdit && id) {
        const updated = await updateCustomer(id, payload)
        toastSuccess('Customer updated', `${updated.first_name} ${updated.last_name} was saved.`)
        navigate(`/customers/${id}`)
      } else {
        const created = await createCustomer(payload)
        toastSuccess('Customer created', `${created.first_name} ${created.last_name} was added.`)
        navigate(`/customers/${created.id}`)
      }
    } catch (err) {
      const apiError = toApiError(err, 'Could not save this customer')
      setSubmitError(apiError.message)
      toastError('Save failed', apiError.message)
    }
  }

  if (loading) {
    return <LoadingState message="Loading customer..." />
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" className="-ml-2" onClick={() => navigate('/customers')}>
          <ArrowLeft className="h-4 w-4" />
          Back to customers
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <AlertCircle className="h-10 w-10 text-red-500" />
            <p className="font-medium text-slate-900 dark:text-slate-100">Could not load customer</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">{loadError}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const submitting = form.formState.isSubmitting

  return (
    <div className="space-y-6">
      <Button
        variant="ghost"
        className="-ml-2"
        onClick={() => navigate(isEdit && id ? `/customers/${id}` : '/customers')}
      >
        <ArrowLeft className="h-4 w-4" />
        {isEdit ? 'Back to customer' : 'Back to customers'}
      </Button>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          {isEdit ? 'Edit customer' : 'New customer'}
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {isEdit
            ? 'Update the contact and address details for this customer.'
            : 'Add a new customer to the QKil database.'}
        </p>
      </div>

      {submitError ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{submitError}</span>
        </div>
      ) : null}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" noValidate>
          <Card>
            <CardHeader>
              <CardTitle>Contact</CardTitle>
              <CardDescription>Name and the best ways to reach this customer.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="first_name"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>First name *</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="James" hasError={Boolean(fieldState.error)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="last_name"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Last name *</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Whitfield" hasError={Boolean(fieldState.error)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="email"
                        placeholder="james@example.co.uk"
                        hasError={Boolean(fieldState.error)}
                      />
                    </FormControl>
                    <FormDescription>Optional - leave blank if not on file.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-5 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormLabel>Phone *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="01632 960 123" hasError={Boolean(fieldState.error)} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="mobile"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormLabel>Mobile</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="07700 900 123" hasError={Boolean(fieldState.error)} />
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
              <CardTitle>Service address</CardTitle>
              <CardDescription>Where treatments will be carried out.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="street"
                render={({ field, fieldState }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Street *</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="14 Beaumont Street"
                        hasError={Boolean(fieldState.error)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="city"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Town / City *</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Oxford" hasError={Boolean(fieldState.error)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="county"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>County</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Oxfordshire"
                        hasError={Boolean(fieldState.error)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="postcode"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Postcode *</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        maxLength={8}
                        placeholder="OX1 2LJ"
                        hasError={Boolean(fieldState.error)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="country"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Country *</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="United Kingdom"
                        hasError={Boolean(fieldState.error)}
                      />
                    </FormControl>
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
                Access instructions, pets on site, chemical restrictions, billing quirks.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="notes"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Internal notes</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={5}
                        placeholder="Dog in backyard - call before arrival."
                        hasError={Boolean(fieldState.error)}
                      />
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
              onClick={() => navigate(isEdit && id ? `/customers/${id}` : '/customers')}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Spinner size="sm" className="text-white" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  {isEdit ? 'Save changes' : 'Create customer'}
                </>
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  )
}

export default CustomerFormPage
