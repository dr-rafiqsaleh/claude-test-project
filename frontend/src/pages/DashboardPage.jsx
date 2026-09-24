import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { addDays, endOfDay, format, startOfDay } from 'date-fns'
import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  FileText,
  MapPin,
  Phone,
  PlayCircle,
  Receipt,
  Send,
} from 'lucide-react'

import { listBookings, updateBookingStatus } from '@/api/bookings'
import { getInvoiceSummary, listInvoices } from '@/api/invoices'
import { listQuotes } from '@/api/quotes'
import { BookingStatusBadge } from '@/components/bookings/BookingStatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState, PageHeader, RefreshButton } from '@/components/ui/page'
import { Spinner } from '@/components/ui/spinner'
import { toastError } from '@/components/ui/use-toast'
import { toApiError } from '@/lib/api'
import { BOOKING_STATUS, UserRole } from '@/lib/constants'
import { cn, formatAddress, formatCurrency, formatTime } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'

/** How many months of history the revenue chart covers. */
const CHART_MONTHS = 6
/** Cap on the pages of invoices pulled in to build the chart. */
const MAX_CHART_PAGES = 5
const CHART_PAGE_SIZE = 100

// The chart library is heavy and only office staff see it, so technicians' phones never download it.
const RevenueCard = lazy(() => import('@/components/dashboard/RevenueCard'))

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function firstName(user) {
  return user?.full_name?.split(' ')[0] ?? ''
}

/** Exact local-day bounds, so "today" is right under BST as well as GMT. */
function dayRange(offsetDays = 0, spanDays = 1) {
  const from = startOfDay(addDays(new Date(), offsetDays))
  const to = endOfDay(addDays(from, spanDays - 1))
  return { date_from: from.toISOString(), date_to: to.toISOString() }
}

const byStart = (a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start)

function visitAddress(visit) {
  return visit.service_address ? formatAddress(visit.service_address) : visit.customer_address
}

const isOpen = (visit) =>
  visit.status === BOOKING_STATUS.SCHEDULED || visit.status === BOOKING_STATUS.CONFIRMED

function Skeleton({ className }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />
}

function Section({ title, count, action, children }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">
          {title}
          {count ? <span className="ml-2 text-sm font-normal text-muted-foreground">{count}</span> : null}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

// --------------------------------------------------------------------------
// Technician: today's visits, one tap to start or carry on
// --------------------------------------------------------------------------

function VisitCard({ visit, onStart, starting }) {
  const address = visitAddress(visit)
  const reportPath = visit.job_id ? `/jobs/${visit.job_id}/report` : null

  return (
    <Card className="overflow-hidden">
      <Link to={`/bookings/${visit.id}`} className="flex gap-4 p-4 transition-colors duration-150 hover:bg-muted/50">
        <div className="w-14 shrink-0">
          <p className="text-lg font-semibold leading-tight text-foreground">{formatTime(visit.scheduled_start)}</p>
          <p className="text-xs text-muted-foreground">to {formatTime(visit.scheduled_end)}</p>
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium text-foreground">{visit.customer_name}</p>
            <BookingStatusBadge status={visit.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {visit.service_type}
            {visit.pest_types?.length ? ` · ${visit.pest_types.join(', ')}` : ''}
          </p>
          {address ? <p className="text-sm text-muted-foreground">{address}</p> : null}
        </div>
      </Link>

      <div className="flex gap-2 border-t border-border p-3">
        {address ? (
          <Button asChild variant="outline" className="h-12 flex-1">
            <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`} target="_blank" rel="noreferrer">
              <MapPin className="h-4 w-4" />
              Map
            </a>
          </Button>
        ) : null}
        {visit.customer_phone ? (
          <Button asChild variant="outline" className="h-12 flex-1">
            <a href={`tel:${visit.customer_phone.replace(/\s/g, '')}`}>
              <Phone className="h-4 w-4" />
              Call
            </a>
          </Button>
        ) : null}
        {isOpen(visit) && onStart ? (
          <Button className="h-12 flex-[2]" disabled={starting} onClick={() => onStart(visit)}>
            {starting ? <Spinner size="sm" className="text-current" /> : <PlayCircle className="h-4 w-4" />}
            Start job
          </Button>
        ) : null}
        {visit.status === BOOKING_STATUS.IN_PROGRESS && reportPath ? (
          <Button asChild className="h-12 flex-[2]">
            <Link to={reportPath}>
              <ClipboardList className="h-4 w-4" />
              Continue report
            </Link>
          </Button>
        ) : null}
        {visit.status === BOOKING_STATUS.COMPLETED ? (
          <p className="flex h-12 flex-[2] items-center justify-center gap-2 text-sm font-medium text-primary">
            <CheckCircle2 className="h-4 w-4" />
            Done
          </p>
        ) : null}
      </div>
    </Card>
  )
}

function TechnicianToday({ user }) {
  const navigate = useNavigate()
  // Bumped by the refresh button; the loader below watches it.
  const [reloads, setReloads] = useState(0)
  const [loading, setLoading] = useState(true)
  const [today, setToday] = useState([])
  const [unfinished, setUnfinished] = useState([])
  const [upcoming, setUpcoming] = useState([])
  const [startingId, setStartingId] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      // The API returns only this technician's own visits.
      const [todayRes, openRes, upcomingRes] = await Promise.allSettled([
        listBookings({ ...dayRange(0), page_size: 100 }),
        listBookings({ status: BOOKING_STATUS.IN_PROGRESS, page_size: 50 }),
        listBookings({ ...dayRange(1, 7), page_size: 20 }),
      ])
      if (cancelled) return
      const todays = todayRes.status === 'fulfilled' ? [...todayRes.value.items].sort(byStart) : []
      const todayIds = new Set(todays.map((visit) => visit.id))
      setToday(todays)
      // Reports still open from earlier days - easy to forget, so they come first.
      setUnfinished(
        openRes.status === 'fulfilled'
          ? openRes.value.items.filter((visit) => !todayIds.has(visit.id)).sort(byStart)
          : [],
      )
      setUpcoming(
        upcomingRes.status === 'fulfilled'
          ? upcomingRes.value.items.filter((visit) => visit.status !== BOOKING_STATUS.CANCELLED).sort(byStart)
          : [],
      )
      setLoading(false)
    }
    setLoading(true)
    void load()
    return () => {
      cancelled = true
    }
  }, [reloads])

  async function startVisit(visit) {
    setStartingId(visit.id)
    try {
      const updated = await updateBookingStatus(visit.id, BOOKING_STATUS.IN_PROGRESS)
      if (updated.job_id) navigate(`/jobs/${updated.job_id}/report`)
    } catch (err) {
      toastError('Could not start the job', toApiError(err).message)
      setStartingId(null)
    }
  }

  const remaining = today.filter(
    (visit) => visit.status !== BOOKING_STATUS.COMPLETED && visit.status !== BOOKING_STATUS.CANCELLED,
  )
  const dateLabel = format(new Date(), 'EEEE d MMMM')

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <PageHeader
        title={`${greeting()}, ${firstName(user)}`}
        description={
          loading
            ? dateLabel
            : `${dateLabel} · ${
                remaining.length === 0
                  ? 'nothing left today'
                  : `${remaining.length} job${remaining.length === 1 ? '' : 's'} to go`
              }`
        }
        actions={<RefreshButton onRefresh={() => setReloads((n) => n + 1)} loading={loading} />}
      />

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <>
          {unfinished.length > 0 ? (
            <Section title="Reports to finish" count={unfinished.length}>
              <div className="space-y-3">
                {unfinished.map((visit) => (
                  <VisitCard key={visit.id} visit={visit} />
                ))}
              </div>
            </Section>
          ) : null}

          <Section title="Today" count={today.length || null}>
            {today.length === 0 ? (
              <Card>
                <EmptyState
                  icon={CalendarCheck}
                  title="No jobs today"
                  description="Anything booked for you will appear here."
                />
              </Card>
            ) : (
              <div className="space-y-3">
                {today.map((visit) => (
                  <VisitCard
                    key={visit.id}
                    visit={visit}
                    onStart={startVisit}
                    starting={startingId === visit.id}
                  />
                ))}
              </div>
            )}
          </Section>

          {upcoming.length > 0 ? (
            <Section
              title="Coming up"
              action={
                <Button asChild variant="link" size="sm" className="h-auto p-0">
                  <Link to="/bookings">
                    All jobs
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              }
            >
              <Card>
                <ul className="divide-y divide-border">
                  {upcoming.map((visit) => (
                    <li key={visit.id}>
                      <Link
                        to={`/bookings/${visit.id}`}
                        className="flex items-center gap-4 px-4 py-3 transition-colors duration-150 hover:bg-muted/50"
                      >
                        <div className="w-20 shrink-0">
                          <p className="text-sm font-medium text-foreground">
                            {format(new Date(visit.scheduled_start), 'EEE d MMM')}
                          </p>
                          <p className="text-xs text-muted-foreground">{formatTime(visit.scheduled_start)}</p>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">{visit.customer_name}</p>
                          <p className="truncate text-xs text-muted-foreground">{visit.service_type}</p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </Section>
          ) : null}
        </>
      )}
    </div>
  )
}

// --------------------------------------------------------------------------
// Office and admin: what needs doing, today's visits, money
// --------------------------------------------------------------------------

function AttentionCard({ icon: Icon, label, value, hint, to, urgent, loading }) {
  return (
    <Link
      to={to}
      className="group rounded-lg border border-border bg-card p-4 transition-colors duration-150 hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <Icon
          className={cn('h-4 w-4', urgent ? 'text-destructive' : 'text-muted-foreground/70')}
          aria-hidden="true"
        />
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-12" />
      ) : (
        <p className={cn('mt-2 text-3xl font-semibold tracking-tight', urgent ? 'text-destructive' : 'text-foreground')}>
          {value}
        </p>
      )}
      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
        {hint}
        <ArrowRight
          className="h-3 w-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          aria-hidden="true"
        />
      </p>
    </Link>
  )
}

function monthStart(monthsAgo) {
  const date = new Date()
  date.setDate(1)
  date.setHours(0, 0, 0, 0)
  date.setMonth(date.getMonth() - monthsAgo)
  return date
}

/** Bucket invoices into the chart window: invoiced vs collected per month. */
function buildRevenueSeries(invoices) {
  const buckets = []
  const index = new Map()
  for (let offset = CHART_MONTHS - 1; offset >= 0; offset -= 1) {
    const start = monthStart(offset)
    const bucket = { month: format(start, 'MMM'), invoiced: 0, collected: 0 }
    buckets.push(bucket)
    index.set(format(start, 'yyyy-MM'), bucket)
  }
  for (const invoice of invoices) {
    const issued = new Date(invoice.issue_date)
    if (Number.isNaN(issued.getTime())) continue
    const bucket = index.get(format(issued, 'yyyy-MM'))
    if (!bucket) continue
    bucket.invoiced += Number(invoice.total ?? 0)
    bucket.collected += Number(invoice.amount_paid ?? 0)
  }
  return buckets.map((bucket) => ({
    ...bucket,
    invoiced: Math.round(bucket.invoiced * 100) / 100,
    collected: Math.round(bucket.collected * 100) / 100,
  }))
}

/** Every invoice issued in the chart window, a page at a time. */
async function fetchChartInvoices() {
  const dateFrom = monthStart(CHART_MONTHS - 1).toISOString()
  const collected = []
  for (let page = 1; page <= MAX_CHART_PAGES; page += 1) {
    // Sequential by design: each page depends on the total from the last one.
    // eslint-disable-next-line no-await-in-loop
    const data = await listInvoices({ page, page_size: CHART_PAGE_SIZE, date_from: dateFrom })
    collected.push(...(data.items ?? []))
    if (collected.length >= (data.total ?? 0) || (data.items ?? []).length === 0) break
  }
  return collected
}

function OfficeToday({ user }) {
  const [reloads, setReloads] = useState(0)
  const [loading, setLoading] = useState(true)
  const [visits, setVisits] = useState([])
  const [reportsDue, setReportsDue] = useState(null)
  const [awaitingReply, setAwaitingReply] = useState(null)
  const [toConfirm, setToConfirm] = useState(null)
  const [summary, setSummary] = useState(null)
  const [revenue, setRevenue] = useState({ state: 'loading', series: [] })

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [todayRes, dueRes, quotesRes, summaryRes, confirmRes] = await Promise.allSettled([
        listBookings({ ...dayRange(0), page_size: 100 }),
        listBookings({ status: BOOKING_STATUS.IN_PROGRESS, page_size: 1 }),
        listQuotes({ status: 'sent', page_size: 1 }),
        getInvoiceSummary(),
        // Booked but not yet confirmed with the customer, in the next fortnight.
        listBookings({ status: BOOKING_STATUS.SCHEDULED, ...dayRange(0, 14), page_size: 1 }),
      ])
      if (cancelled) return
      setToConfirm(confirmRes.status === 'fulfilled' ? confirmRes.value.total : null)
      setVisits(todayRes.status === 'fulfilled' ? [...todayRes.value.items].sort(byStart) : [])
      setReportsDue(dueRes.status === 'fulfilled' ? dueRes.value.total : null)
      setAwaitingReply(quotesRes.status === 'fulfilled' ? quotesRes.value.total : null)
      setSummary(summaryRes.status === 'fulfilled' ? summaryRes.value : null)
      setLoading(false)

      // The chart is the slowest piece; it fills in last without holding up the rest.
      try {
        const invoices = await fetchChartInvoices()
        if (!cancelled) setRevenue({ state: 'ready', series: buildRevenueSeries(invoices) })
      } catch {
        if (!cancelled) setRevenue({ state: 'failed', series: [] })
      }
    }
    setLoading(true)
    setRevenue({ state: 'loading', series: [] })
    void load()
    return () => {
      cancelled = true
    }
  }, [reloads])

  const show = (value) => (value === null || value === undefined ? '--' : value)
  const drafts = summary ? (summary.invoice_count_by_status?.draft ?? 0) : null
  const overdueCount = summary ? (summary.overdue_count ?? 0) : null
  const remaining = visits.filter(
    (visit) => visit.status !== BOOKING_STATUS.COMPLETED && visit.status !== BOOKING_STATUS.CANCELLED,
  )
  const technicianCount = useMemo(
    () => new Set(visits.map((visit) => visit.technician_name).filter(Boolean)).size,
    [visits],
  )

  return (
    <div className="space-y-8">
      <PageHeader
        title={`${greeting()}, ${firstName(user)}`}
        description={format(new Date(), 'EEEE d MMMM')}
        actions={
          <>
            <RefreshButton onRefresh={() => setReloads((n) => n + 1)} loading={loading} />
            <Button asChild variant="outline">
              <Link to="/quotes/new">
                <FileText className="h-4 w-4" />
                New quote
              </Link>
            </Button>
            <Button asChild>
              <Link to="/bookings/new">
                <CalendarPlus className="h-4 w-4" />
                Book a job
              </Link>
            </Button>
          </>
        }
      />

      <Section title="Needs attention">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <AttentionCard
            icon={CalendarCheck}
            label="To confirm"
            value={show(toConfirm)}
            hint="Jobs in the next 14 days not yet confirmed with the customer"
            to="/bookings?status=scheduled"
            loading={loading}
          />
          <AttentionCard
            icon={ClipboardList}
            label="Reports due"
            value={show(reportsDue)}
            hint="Jobs started, report not filed"
            to="/bookings?status=in_progress"
            loading={loading}
          />
          <AttentionCard
            icon={FileText}
            label="Awaiting reply"
            value={show(awaitingReply)}
            hint="Quotes sent to customers"
            to="/quotes?status=sent"
            loading={loading}
          />
          <AttentionCard
            icon={Send}
            label="Ready to send"
            value={show(drafts)}
            hint="Draft invoices"
            to="/invoices?status=draft"
            loading={loading}
          />
          <AttentionCard
            icon={AlertTriangle}
            label="Overdue"
            value={summary ? formatCurrency(summary.total_overdue ?? 0) : '--'}
            hint={overdueCount ? `${overdueCount} invoice${overdueCount === 1 ? '' : 's'} past due` : 'Nothing past due'}
            to="/invoices?overdue=1"
            urgent={(summary?.total_overdue ?? 0) > 0}
            loading={loading}
          />
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">Today&apos;s jobs</CardTitle>
              <CardDescription>
                {loading
                  ? 'Loading...'
                  : visits.length === 0
                    ? 'Nothing booked today.'
                    : `${visits.length} booked across ${technicianCount} technician${technicianCount === 1 ? '' : 's'} · ${remaining.length} still to do`}
              </CardDescription>
            </div>
            <Button asChild variant="link" size="sm" className="h-auto shrink-0 p-0">
              <Link to="/bookings?view=calendar">
                Calendar
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="space-y-3 px-6 pb-6">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            ) : visits.length === 0 ? (
              <EmptyState
                icon={CalendarCheck}
                title="No jobs today"
                className="py-10"
                action={
                  <Button asChild variant="outline" size="sm">
                    <Link to="/bookings/new">Book a job</Link>
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {visits.map((visit) => (
                  <li key={visit.id}>
                    <Link
                      to={`/bookings/${visit.id}`}
                      className="flex items-center gap-4 px-6 py-3 transition-colors duration-150 hover:bg-muted/50"
                    >
                      <p className="w-12 shrink-0 text-sm font-medium tabular-nums text-foreground">
                        {formatTime(visit.scheduled_start)}
                      </p>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{visit.customer_name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {visit.service_type} · {visit.technician_name ?? 'Unassigned'}
                        </p>
                      </div>
                      <BookingStatusBadge status={visit.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Money</CardTitle>
            <CardDescription>Across all invoices.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {[
              { label: 'Outstanding', value: summary?.total_outstanding },
              { label: 'Collected this month', value: summary?.collected_this_month },
              { label: 'Invoiced to date', value: summary?.total_invoiced },
            ].map((row) => (
              <div key={row.label}>
                <p className="text-sm text-muted-foreground">{row.label}</p>
                {loading ? (
                  <Skeleton className="mt-1 h-7 w-28" />
                ) : (
                  <p className="text-2xl font-semibold tracking-tight text-foreground">
                    {row.value === null || row.value === undefined ? '--' : formatCurrency(row.value)}
                  </p>
                )}
              </div>
            ))}
            <Button asChild variant="outline" className="w-full">
              <Link to="/invoices">
                <Receipt className="h-4 w-4" />
                Go to invoices
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Suspense fallback={<Skeleton className="h-[380px]" />}>
        <RevenueCard series={revenue.series} state={revenue.state} months={CHART_MONTHS} />
      </Suspense>
    </div>
  )
}

/** "Today": what this person needs to do now. Technicians and office see different things. */
export function DashboardPage() {
  const user = useAuthStore((state) => state.user)
  return user?.role === UserRole.TECHNICIAN ? <TechnicianToday user={user} /> : <OfficeToday user={user} />
}

export default DashboardPage
