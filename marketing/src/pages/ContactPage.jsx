import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle, CheckCircle2, LogIn, ShieldCheck } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Link, useSearchParams } from 'react-router-dom'
import { z } from 'zod'

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { SIGN_IN_URL } from '@/content/company'
import { ApiError, sendEnquiry } from '@/lib/api'

/** Must match TOPICS in backend/app/services/contact_service.py. */
const TOPICS = [
  { value: 'demo', label: 'Book a demo' },
  { value: 'sales', label: 'Pricing and plans' },
  { value: 'support', label: 'Help with PestBase' },
  { value: 'privacy', label: 'Privacy or data request' },
  { value: 'other', label: 'Something else' },
]
const TOPIC_VALUES = TOPICS.map((topic) => topic.value)

const phoneRegex = /^[0-9+()\-\s]{6,20}$/

const contactSchema = z.object({
  name: z.string().trim().min(1, 'Please tell us your name').max(120),
  email: z.string().trim().min(1, 'We need an email address to reply to').email('Enter a valid email address').max(200),
  company: z.string().trim().max(160),
  phone: z
    .string()
    .trim()
    .refine((value) => value === '' || phoneRegex.test(value), { message: 'Enter a valid phone number' }),
  topic: z.enum(TOPIC_VALUES),
  message: z
    .string()
    .trim()
    .min(10, 'Please give us a little more detail (at least 10 characters)')
    .max(5000, 'Please keep your message under 5,000 characters'),
  // The honeypot. Hidden from people; a bot that fills it in is quietly ignored.
  website: z.string().max(200).optional(),
})

function initialTopic(searchParams) {
  const topic = searchParams.get('topic')
  return TOPIC_VALUES.includes(topic) ? topic : 'demo'
}

function SentMessage({ onReset }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center px-6 py-14 text-center">
        <CheckCircle2 className="h-12 w-12 text-primary" aria-hidden="true" />
        <h2 className="mt-4 text-2xl font-semibold">Thanks - message sent</h2>
        <p className="mt-2 max-w-md text-muted-foreground">
          We&apos;ve got your message and will reply by email.
        </p>
        <Button variant="outline" className="mt-6" onClick={onReset}>
          Send another message
        </Button>
      </CardContent>
    </Card>
  )
}

export default function ContactPage() {
  const [searchParams] = useSearchParams()
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(null)

  const form = useForm({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      name: '',
      email: '',
      company: '',
      phone: '',
      topic: initialTopic(searchParams),
      message: '',
      website: '',
    },
  })

  const onSubmit = async (values) => {
    setError(null)
    try {
      await sendEnquiry({
        ...values,
        company: values.company || null,
        phone: values.phone || null,
      })
      setSent(true)
      form.reset({ ...form.getValues(), message: '' })
    } catch (err) {
      const fieldErrors = err instanceof ApiError ? err.fieldErrors : undefined
      fieldErrors?.forEach(({ field, message }) => {
        if (field in contactSchema.shape) form.setError(field, { message })
      })
      setError(err.message)
    }
  }

  const submitting = form.formState.isSubmitting

  return (
    <div className="mx-auto max-w-6xl px-4 pb-20 pt-14 sm:px-6">
      <div className="max-w-2xl">
        <span className="inline-block rounded-full bg-accent px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-accent-foreground">
          Contact us
        </span>
        <h1 className="mt-4 text-4xl font-bold tracking-tight">Talk to the PestBase team.</h1>
        <p className="mt-3 text-lg text-muted-foreground">
          Book a demo, ask about pricing, or tell us what you need. Send us a message and we&apos;ll reply by email.
        </p>
      </div>

      <div className="mt-10 grid items-start gap-8 lg:grid-cols-[1fr_320px]">
        {sent ? (
          <SentMessage onReset={() => setSent(false)} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Send us a message</CardTitle>
              <CardDescription>Fields marked * are required.</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-5">
                  {error ? (
                    <div
                      role="alert"
                      className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                    >
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{error}</span>
                    </div>
                  ) : null}

                  <div className="grid gap-5 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field, fieldState }) => (
                        <FormItem>
                          <FormLabel>Your name *</FormLabel>
                          <FormControl>
                            <Input {...field} autoComplete="name" hasError={Boolean(fieldState.error)} />
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
                          <FormLabel>Work email *</FormLabel>
                          <FormControl>
                            <Input {...field} type="email" autoComplete="email" hasError={Boolean(fieldState.error)} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="company"
                      render={({ field, fieldState }) => (
                        <FormItem>
                          <FormLabel>Company</FormLabel>
                          <FormControl>
                            <Input {...field} autoComplete="organization" hasError={Boolean(fieldState.error)} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="phone"
                      render={({ field, fieldState }) => (
                        <FormItem>
                          <FormLabel>Phone</FormLabel>
                          <FormControl>
                            <Input {...field} type="tel" autoComplete="tel" hasError={Boolean(fieldState.error)} />
                          </FormControl>
                          <FormDescription>Optional, if you&apos;d like a call back.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="topic"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>What is it about? *</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {TOPICS.map((topic) => (
                              <SelectItem key={topic.value} value={topic.value}>
                                {topic.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="message"
                    render={({ field, fieldState }) => (
                      <FormItem>
                        <FormLabel>Message *</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            rows={6}
                            placeholder="Tell us about your business: how many technicians, what you use today, what you need."
                            hasError={Boolean(fieldState.error)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* The honeypot: off-screen and skipped by keyboard and screen readers. */}
                  <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
                    <label htmlFor="contact-website">Leave this empty</label>
                    <input id="contact-website" type="text" tabIndex={-1} autoComplete="off" {...form.register('website')} />
                  </div>

                  <p className="text-sm text-muted-foreground">
                    We use these details only to answer your message. See our{' '}
                    <Link to="/privacy" className="font-medium text-primary underline underline-offset-4">
                      privacy policy
                    </Link>
                    .
                  </p>

                  <div>
                    <Button type="submit" size="lg" disabled={submitting}>
                      {submitting ? 'Sending...' : 'Send message'}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        )}

        <aside className="grid gap-4">
          <Card>
            <CardContent className="flex gap-3 p-5">
              <LogIn className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <div className="text-sm">
                <h2 className="font-semibold">Already a customer?</h2>
                <p className="mt-1 text-muted-foreground">
                  Sign in to PestBase. Your administrator can add users and change settings.
                </p>
                <a href={SIGN_IN_URL} className="mt-2 inline-block font-medium text-primary underline underline-offset-4">
                  Sign in
                </a>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex gap-3 p-5">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <div className="text-sm">
                <h2 className="font-semibold">Privacy and data requests</h2>
                <p className="mt-1 text-muted-foreground">
                  Choose &ldquo;Privacy or data request&rdquo; above for access, correction or deletion requests, or
                  a data-protection complaint.
                </p>
                <Link to="/privacy" className="mt-2 inline-block font-medium text-primary underline underline-offset-4">
                  Read the privacy policy
                </Link>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  )
}
