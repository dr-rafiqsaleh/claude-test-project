import { Bell, CalendarDays, FileText, Mail, PoundSterling, Search } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SIGN_IN_URL } from '@/content/company'
import { cn } from '@/lib/utils'

const STEPS = [
  ['Capture', 'Add the customer and site, with search and history.'],
  ['Quote', 'Line-item quotes, sent as a branded PDF.'],
  ['Schedule', 'Book the visit and assign a technician, or make it repeat.'],
  ['Inspect', 'The technician files the report on site: findings, photos, products, signatures.'],
  ['Invoice', 'The invoice is raised as soon as the job is signed off.'],
  ['Get paid', 'Record part payments, and get reminders about overdue invoices.'],
]

const FEATURES = [
  {
    icon: FileText,
    title: 'Inspection & treatment reports',
    body: 'Pest activity, findings with photo evidence, priority, and who needs to act. Hygiene and proofing, products with active ingredient and HSE/MAPP number, safety advice, and signatures.',
  },
  {
    icon: CalendarDays,
    title: 'Scheduling & repeating jobs',
    body: 'A calendar with technician assignment. Weekly, fortnightly, monthly or quarterly contracts book a year ahead and keep UK clock time across the clock changes.',
  },
  {
    icon: PoundSterling,
    title: 'Quotes & invoicing',
    body: 'Numbered quotes and invoices, part payments and overdue tracking. A single switch for VAT: nothing charges VAT until you are registered, then invoices become tax invoices.',
  },
  {
    icon: Mail,
    title: 'Email from your own address',
    body: 'Send quotes, invoices and reports with the PDF attached, through Microsoft 365 or your own mail server. Templates are editable, and every document keeps a send history.',
  },
  {
    icon: Bell,
    title: 'Reminders that run themselves',
    body: "Tomorrow's bookings, imminent visits, overdue and soon-due invoices, job follow-ups and quotes about to expire, all shown in the app without being set up.",
  },
  {
    icon: Search,
    title: 'Find anything',
    body: 'One search across customers, quotes, bookings, jobs and invoices. Your branding, logo and colour appear on every PDF you send.',
  },
]

const ON_SITE = [
  "Today's visits, with one tap to call the site contact or get directions.",
  "Photos straight from the phone's camera, attached to each finding.",
  'Products picked from your own list, with HSE/MAPP numbers already filled in.',
  "The customer signs on screen, or the technician records why they couldn't.",
  'The finished report is emailed to the customer as a PDF.',
]

const ACCOUNTS = [
  ['Office', 'Everything, on a laptop or desktop.'],
  ['Technicians', 'Assigned jobs and reports. They never see prices or invoices.'],
  ['Admins', 'Users, roles, company settings and branding.'],
  ['Sign-in', 'No passwords to forget. An emailed link or a six-digit code.'],
]

const SECURITY = [
  [
    'No passwords',
    'Sign-in is by a one-time link or code sent to a registered address, so there is no password to reuse, guess or leak.',
  ],
  [
    'Roles enforced on the server',
    'Admin, office and technician access is checked for every request. You can also define your own roles.',
  ],
  [
    'Audit trail & support access',
    'A tamper-evident record of important changes. Our support team sees your data only during a time-limited access window you can see, normally one you open yourself.',
  ],
]

function Eyebrow({ children }) {
  return (
    <span className="inline-block rounded-full bg-accent px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-accent-foreground">
      {children}
    </span>
  )
}

function SectionHead({ eyebrow, title, children }) {
  return (
    <div className="mb-10 max-w-2xl">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
      {children ? <p className="mt-3 text-lg text-muted-foreground">{children}</p> : null}
    </div>
  )
}

function Section({ id, alt, children }) {
  return (
    <section id={id} className={cn('py-16 sm:py-20', alt && 'border-y bg-muted/40')}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">{children}</div>
    </section>
  )
}

const PILL = {
  green: 'bg-emerald-100 text-emerald-800',
  amber: 'bg-amber-100 text-amber-800',
  slate: 'bg-slate-200 text-slate-700',
}

/** A phone showing a technician's day, drawn in markup. Always light, like a phone screen in daylight. */
function PhoneMockup() {
  const visits = [
    { title: 'Rodent follow-up', meta: '09:00 · Bakery, High Street', pill: ['Confirmed', 'green'], actions: ['Call', 'Directions', 'Start'] },
    { title: 'Wasp nest treatment', meta: '11:30 · Residential', pill: ['In progress', 'amber'], actions: ['Photos', 'Products', 'Report'] },
    { title: 'Quarterly inspection', meta: '14:00 · Warehouse unit', pill: ['Repeating', 'slate'] },
  ]

  return (
    <div
      role="img"
      aria-label="PestBase in a phone browser, showing today's visits"
      className="mx-auto w-72 max-w-full rounded-[2.4rem] bg-slate-900 p-3 shadow-2xl shadow-emerald-900/25"
    >
      <div aria-hidden="true" className="overflow-hidden rounded-[1.8rem] bg-slate-50 text-[0.8rem] text-slate-900">
        <div className="flex items-center justify-between bg-[#047857] px-4 pb-3.5 pt-5 text-white">
          <strong className="text-sm">Today&apos;s visits</strong>
          <span className="text-xs opacity-85">3 jobs</span>
        </div>
        <div className="grid gap-2.5 p-3">
          {visits.map((visit) => (
            <div key={visit.title} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{visit.title}</span>
                <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[0.65rem] font-semibold', PILL[visit.pill[1]])}>
                  {visit.pill[0]}
                </span>
              </div>
              <div className="mt-0.5 text-[0.72rem] text-slate-500">{visit.meta}</div>
              {visit.actions ? (
                <div className="mt-2 flex gap-1.5">
                  {visit.actions.map((action, index) => (
                    <span
                      key={action}
                      className={cn(
                        'flex-1 rounded-lg py-1 text-center text-[0.68rem] font-semibold',
                        index === visit.actions.length - 1 ? 'bg-[#047857] text-white' : 'bg-slate-100 text-slate-700',
                      )}
                    >
                      {action}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div className="flex justify-around border-t border-slate-200 bg-white pb-3.5 pt-2.5 text-[0.65rem] text-slate-500">
          <b className="text-[#047857]">Jobs</b>
          <span>Diary</span>
          <span>Search</span>
          <span>Alerts</span>
        </div>
      </div>
    </div>
  )
}

export default function HomePage() {
  return (
    <>
      <section className="overflow-hidden py-16 sm:py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <Eyebrow>Built for UK pest control</Eyebrow>
            <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              Run your pest control business from first call to paid invoice.
            </h1>
            <p className="mt-4 max-w-xl text-lg text-muted-foreground">
              PestBase keeps your customers, quotes, visits, inspection reports and invoices in one place. The office
              books the work, technicians file photographic reports from their phone, and the invoice raises itself
              when the job is signed off.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/contact?topic=demo">Book a demo</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/#features">See what it does</Link>
              </Button>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Works in any modern browser, on a desktop, tablet or phone. Nothing to install.
            </p>
          </div>
          <PhoneMockup />
        </div>
      </section>

      <Section id="how-it-works" alt>
        <SectionHead eyebrow="How it works" title="One job, start to finish, without retyping anything.">
          Each step picks up where the last one left off, so a customer&apos;s details are entered once.
        </SectionHead>
        <ol className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {STEPS.map(([title, body], index) => (
            <li key={title} className="rounded-lg border bg-card p-4">
              <span className="inline-grid h-7 w-7 place-items-center rounded-full bg-accent text-sm font-bold text-accent-foreground">
                {index + 1}
              </span>
              <h3 className="mb-1 mt-2.5 font-semibold">{title}</h3>
              <p className="text-sm text-muted-foreground">{body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="features">
        <SectionHead eyebrow="Features" title="Everything the office and the field need.">
          Made for small and mid-sized UK operators, not adapted from a generic field-service tool.
        </SectionHead>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <Card key={title}>
              <CardContent className="p-6">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-accent text-accent-foreground">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <h3 className="mb-1.5 mt-3 text-lg font-semibold">{title}</h3>
                <p className="text-sm text-muted-foreground">{body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>

      <Section id="on-site" alt>
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <SectionHead eyebrow="On site" title="Your technicians' whole day, on their phone.">
              PestBase is laid out for a phone screen as well as a desktop, so technicians open it in their phone&apos;s
              browser: big buttons, the camera one tap away, and nothing a technician doesn&apos;t need.
            </SectionHead>
            <ul className="-mt-4 space-y-3">
              {ON_SITE.map((item) => (
                <li key={item} className="flex gap-3">
                  <span aria-hidden="true" className="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor">
                      <path d="M8.1 13.3 4.8 10l-1.1 1.1 4.4 4.4 8.3-8.3-1.1-1.1z" />
                    </svg>
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <Card>
            <CardContent className="p-7">
              <h3 className="mb-4 text-lg font-semibold">The same account on every device</h3>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
                {ACCOUNTS.map(([term, detail]) => (
                  <div key={term} className="contents">
                    <dt className="font-semibold">{term}</dt>
                    <dd className="text-muted-foreground">{detail}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section id="security">
        <SectionHead eyebrow="Security" title="Your customers' data stays under your control." />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {SECURITY.map(([title, body]) => (
            <Card key={title}>
              <CardContent className="p-6">
                <h3 className="mb-1.5 font-semibold">{title}</h3>
                <p className="text-sm text-muted-foreground">{body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>

      <section className="pb-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="rounded-3xl bg-[#047857] px-6 py-14 text-center text-white">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">See PestBase with your own jobs.</h2>
            <p className="mx-auto mb-7 mt-3 max-w-xl opacity-90">
              Tell us a little about your business and we&apos;ll arrange a walkthrough of PestBase.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button asChild size="lg" className="bg-white text-[#065f46] hover:bg-emerald-50">
                <Link to="/contact?topic=demo">Book a demo</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-white/50 bg-transparent text-white hover:bg-white/10 hover:text-white">
                <a href={SIGN_IN_URL}>Already a customer? Sign in</a>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
