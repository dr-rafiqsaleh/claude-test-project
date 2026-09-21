import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertCircle, Eye, EyeOff, LogIn } from 'lucide-react'

import { login as loginRequest } from '@/api/auth'
import { Logo } from '@/components/layout/Logo'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo size={48} textClassName="text-2xl text-white" />
          <p className="text-sm text-slate-400">Pest control management</p>
        </div>

        <Card className="shadow-xl">
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Enter your QKil credentials to continue.</CardDescription>
          </CardHeader>

          <CardContent>
            {formError ? (
              <div
                role="alert"
                className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            ) : null}

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
                            className="pr-10"
                            hasError={Boolean(fieldState.error)}
                            disabled={submitting}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((v) => !v)}
                            className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                            tabIndex={-1}
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Spinner size="sm" className="text-white" />
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
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-slate-500">
          QKil Phase 8 &middot; Need access? Contact your administrator.
        </p>
      </div>
    </div>
  )
}

export default LoginPage
