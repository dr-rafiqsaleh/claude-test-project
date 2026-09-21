import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertCircle, CheckCircle2, Eye, EyeOff, LogIn } from 'lucide-react'

import { login as loginRequest } from '@/api/auth'
import { Logo } from '@/components/layout/Logo'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { toApiError } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

const BRAND_POINTS = [
  'Book jobs and assign technicians in a few taps',
  'Photo inspection reports filed on site, signed on the phone',
  'Invoices raised the moment a job is completed',
]

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const setAuth = useAuthStore((state) => state.setAuth)
  const accessToken = useAuthStore((state) => state.accessToken)
  const [formError, setFormError] = useState(null)
  const [showPassword, setShowPassword] = useState(false)

  const redirectTo = location.state?.from ?? '/dashboard'

  const form = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
    mode: 'onSubmit',
  })

  useEffect(() => {
    if (accessToken) navigate(redirectTo, { replace: true })
  }, [accessToken, navigate, redirectTo])

  async function onSubmit(values) {
    setFormError(null)
    try {
      const tokens = await loginRequest({ email: values.email.trim(), password: values.password })
      setAuth(tokens.user, tokens.access_token, tokens.refresh_token)
      navigate(redirectTo, { replace: true })
    } catch (err) {
      const apiError = toApiError(err, 'Unable to sign in. Please try again.')
      setFormError(apiError.status === 401 ? 'Incorrect email or password.' : apiError.message)
      form.setValue('password', '')
    }
  }

  const submitting = form.formState.isSubmitting

  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-2">
      {/* Brand panel: what QKil is for, on screens with room for it */}
      <div className="hidden flex-col justify-between bg-primary p-12 text-primary-foreground lg:flex">
        <Logo size={40} textClassName="text-xl text-primary-foreground" />
        <div className="max-w-md space-y-6">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">
            Every job, from first quote to paid invoice.
          </h2>
          <ul className="space-y-3 text-base text-primary-foreground/85">
            {BRAND_POINTS.map((point) => (
              <li key={point} className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                {point}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-primary-foreground/70">Pest control management for UK operators</p>
      </div>

      <div className="flex items-center justify-center px-4 py-12 sm:px-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo size={40} subtitle="Pest Control" />
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Enter your QKil email and password.</p>

          {formError ? (
            <div
              role="alert"
              className="mt-6 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{formError}</span>
            </div>
          ) : null}

          <div className="mt-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
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
                      autoComplete="email"
                      placeholder="you@qkil.co.uk"
                      className="h-11"
                      hasError={Boolean(fieldState.error)}
                      disabled={submitting}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        {...field}
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        placeholder="••••••••"
                        className="h-11 pr-11"
                        hasError={Boolean(fieldState.error)}
                        disabled={submitting}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        aria-pressed={showPassword}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" className="h-11 w-full" disabled={submitting}>
              {submitting ? (
                <>
                  <Spinner size="sm" className="text-current" />
                  Signing in...
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4" />
                  Sign in
                </>
              )}
            </Button>
          </form>
        </Form>
          </div>

          <p className="mt-8 text-sm text-muted-foreground">Need access? Ask your administrator to add you.</p>
        </div>
      </div>
    </div>
  )
}

export default LoginPage
