import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, ArrowLeft, CheckCircle2, Mail, ShieldCheck } from 'lucide-react'
import Passwordless from 'supertokens-auth-react/recipe/passwordless'

import { getMe } from '@/api/auth'
import { Logo } from '@/components/layout/Logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { useAuthStore } from '@/store/authStore'

const BRAND_POINTS = [
  'Book jobs and assign technicians in a few taps',
  'Photo inspection reports filed on site, signed on the phone',
  'Invoices raised the moment a job is completed',
]

/** Whether this page was opened by following a link from an email. */
function isMagicLinkLanding() {
  return window.location.pathname.includes('/verify')
}

/**
 * Sign in, without a password.
 *
 * You type your email address, PestBase emails you a link and a six-digit code, and
 * either one signs you in. Nobody has a password to forget, reuse or leak.
 *
 * Both are offered on purpose. A link is one tap on the phone the email arrived
 * on; the code is what a technician needs when the email is on a different
 * device, or when a site phone will not open links from mail.
 *
 * The API deliberately gives the same answer whether an address is unknown,
 * deactivated or belongs to a suspended client - otherwise this form becomes a
 * way to find out who has a PestBase account.
 */
export function LoginPage() {
  const navigate = useNavigate()
  const setUser = useAuthStore((state) => state.setUser)
  const setWorkingClient = useAuthStore((state) => state.setWorkingClient)

  const [step, setStep] = useState(isMagicLinkLanding() ? 'link' : 'email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  /**
   * Turn a fresh session into a signed-in app.
   *
   * SuperTokens having accepted the code is only half of it: the portal draws
   * every menu and guard from the PestBase profile behind that session, and until
   * it is loaded `user` is null - which the route guard reads as "not signed
   * in" and bounces straight back here. So the profile is fetched before
   * navigating anywhere.
   */
  async function finishSignIn() {
    // A client left over from a previous session in this browser is not this
    // person's, and for a client's own team it is meaningless.
    setWorkingClient(null)
    try {
      setUser(await getMe())
      // The index route sends them on by who they are; see HomeRedirect.
      navigate('/', { replace: true })
      return true
    } catch {
      setError(
        'You are signed in, but your PestBase account could not be loaded. ' +
        'Ask an administrator to check the account is active.',
      )
      return false
    }
  }

  // Opened from the email: consume the link and go straight in.
  useEffect(() => {
    if (step !== 'link') return

    let cancelled = false
    async function consumeLink() {
      try {
        const result = await Passwordless.consumeCode()
        if (cancelled) return
        if (result.status === 'OK') {
          if (!(await finishSignIn())) setStep('email')
          return
        }
        setError(
          result.status === 'EXPIRED_USER_INPUT_CODE_ERROR' ||
          result.status === 'RESTART_FLOW_ERROR'
            ? 'That link has expired. Ask for a new one.'
            : 'That link could not be used. Ask for a new one.',
        )
        setStep('email')
      } catch {
        if (cancelled) return
        setError('That link could not be used. Ask for a new one.')
        setStep('email')
      }
    }

    void consumeLink()
    return () => {
      cancelled = true
    }
  }, [step, navigate])

  async function sendCode(event) {
    event?.preventDefault()
    setError(null)

    const address = email.trim().toLowerCase()
    if (!address) {
      setError('Enter your email address.')
      return
    }

    setBusy(true)
    try {
      const result = await Passwordless.createCode({ email: address })
      if (result.status === 'OK') {
        setStep('code')
      } else {
        // GENERAL_ERROR: unknown address, deactivated account, suspended
        // client, or too many attempts. The server writes the wording.
        setError(result.fetchResponse ? await messageFrom(result) : 'Could not send a sign-in email.')
      }
    } catch {
      setError('Cannot reach the PestBase server. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function submitCode(event) {
    event.preventDefault()
    setError(null)

    const typed = code.trim()
    if (!typed) {
      setError('Enter the code from the email.')
      return
    }

    setBusy(true)
    try {
      const result = await Passwordless.consumeCode({ userInputCode: typed })
      if (result.status === 'OK') {
        await finishSignIn()
        return
      }
      if (result.status === 'INCORRECT_USER_INPUT_CODE_ERROR') {
        const left = result.maximumCodeInputAttempts - result.failedCodeInputAttemptCount
        setError(`That code is not right. ${left} attempt${left === 1 ? '' : 's'} left.`)
      } else if (result.status === 'EXPIRED_USER_INPUT_CODE_ERROR') {
        setError('That code has expired. Ask for a new one.')
      } else {
        setError('Start again and ask for a new code.')
        setStep('email')
      }
    } catch {
      setError('Cannot reach the PestBase server. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function messageFrom(result) {
    try {
      return (await result.fetchResponse.clone().json()).message || 'Could not send a sign-in email.'
    } catch {
      return 'Could not send a sign-in email.'
    }
  }

  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-2">
      {/* Brand panel: what PestBase is for, on screens with room for it */}
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

          {step === 'link' ? (
            <div className="space-y-4 text-center">
              <Spinner />
              <p className="text-sm text-muted-foreground">Signing you in...</p>
            </div>
          ) : null}

          {step === 'email' ? (
            <>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Sign in</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                We will email you a link and a code. There is no password to remember.
              </p>

              {error ? <ErrorNote message={error} /> : null}

              <form onSubmit={sendCode} className="mt-6 space-y-4" noValidate>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    autoFocus
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@pestbase.co.uk"
                    className="h-11"
                    disabled={busy}
                  />
                </div>

                <Button type="submit" className="h-11 w-full" disabled={busy}>
                  {busy ? (
                    <>
                      <Spinner size="sm" className="text-current" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Mail className="h-4 w-4" />
                      Email me a sign-in link
                    </>
                  )}
                </Button>
              </form>
            </>
          ) : null}

          {step === 'code' ? (
            <>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Check your email</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                We sent a link and a six-digit code to{' '}
                <span className="font-medium text-foreground">{email.trim().toLowerCase()}</span>. Tap
                the link, or type the code here.
              </p>

              {error ? <ErrorNote message={error} /> : null}

              <form onSubmit={submitCode} className="mt-6 space-y-4" noValidate>
                <div className="space-y-1.5">
                  <Label htmlFor="code">Code</Label>
                  <Input
                    id="code"
                    // A numeric keypad on a phone, and the OS offers the code
                    // straight from the email notification.
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    placeholder="123456"
                    className="h-11 text-center text-lg tracking-[0.3em]"
                    disabled={busy}
                  />
                </div>

                <Button type="submit" className="h-11 w-full" disabled={busy}>
                  {busy ? (
                    <>
                      <Spinner size="sm" className="text-current" />
                      Checking...
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="h-4 w-4" />
                      Sign in
                    </>
                  )}
                </Button>

                <div className="flex items-center justify-between text-sm">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setStep('email')
                      setCode('')
                      setError(null)
                    }}
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Different email
                  </button>
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    disabled={busy}
                    onClick={() => void sendCode()}
                  >
                    Send another
                  </button>
                </div>
              </form>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ErrorNote({ message }) {
  return (
    <div
      role="alert"
      className="mt-6 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

export default LoginPage
