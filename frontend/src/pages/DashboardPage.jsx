import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  ClipboardList,
  Receipt,
  Users,
  Wallet,
} from 'lucide-react'

import { getCalendarEvents } from '@/api/bookings'
import { listCustomers } from '@/api/customers'
import { listInvoices, getInvoiceSummary } from '@/api/invoices'
import { listJobs } from '@/api/jobs'
import { InvoiceStatusBadge } from '@/components/invoices/InvoiceStatusBadge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAuthStore } from '@/store/authStore'
import { cn, formatBookingDateTime, formatCurrency } from '@/lib/utils'
import { BOOKING_STATUS, JOB_STATUS, ROLE_LABELS } from '@/lib/constants'

/** How many months of history the revenue chart covers. */
const CHART_MONTHS = 6

/** Cap on the pages of invoices pulled in to build the chart. */
const MAX_CHART_PAGES = 5
const CHART_PAGE_SIZE = 100

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/** The first day of the month, `monthsAgo` months back. */
function monthStart(monthsAgo = 0) {
  const date = new Date()
  date.setDate(1)
  date.setHours(0, 0, 0, 0)
  date.setMonth(date.getMonth() - monthsAgo)
  return date
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** Bucket invoices into the last six months of invoiced vs collected revenue. */
function buildRevenueSeries(invoices) {
  const buckets = []
  const index = new Map()

  for (let offset = CHART_MONTHS - 1; offset >= 0; offset -= 1) {
    const start = monthStart(offset)
    const bucket = { month: format(start, 'MMM'), invoiced: 0, collected: 0 }
    buckets.push(bucket)
    index.set(monthKey(start), bucket)
  }

  for (const invoice of invoices) {
    const issued = new Date(invoice.issue_date)
    if (Number.isNaN(issued.getTime())) continue

    const bucket = index.get(monthKey(issued))
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

/** Pull every invoice issued in the chart window, a page at a time. */
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

function StatSkeleton() {
  return <div className="h-8 w-20 animate-pulse rounded bg-muted" />
}

function RowSkeleton({ className }) {
  return <div className={cn('h-4 animate-pulse rounded bg-muted', className)} />
}

function StatCard({ label, value, icon: Icon, hint, to, linkLabel, loading, tone = 'default' }) {
  const tones = {
    default: 'text-foreground',
    emerald: 'text-primary',
    red: 'text-destructive',
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
        <Icon className={cn('h-4 w-4', tone === 'red' ? 'text-destructive' : 'text-primary')} />
      </CardHeader>
      <CardContent>
        {loading ? (
          <StatSkeleton />
        ) : (
          <span className={cn('text-3xl font-semibold tracking-tight', tones[tone])}>{value}</span>
        )}
        <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
        {to ? (
          <Button asChild variant="link" size="sm" className="mt-2 h-auto p-0">
            <Link to={to}>
              {linkLabel}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function DashboardPage() {
  const user = useAuthStore((state) => state.user)
  const canSeeInvoices = useAuthStore((state) => state.canWrite())

  const [loading, setLoading] = useState(true)
  const [customerCount, setCustomerCount] = useState(null)
  const [activeBookingCount, setActiveBookingCount] = useState(null)
  const [pendingJobCount, setPendingJobCount] = useState(null)
  const [summary, setSummary] = useState(null)
  const [revenue, setRevenue] = useState([])
  const [revenueFailed, setRevenueFailed] = useState(false)
  const [recentInvoices, setRecentInvoices] = useState([])
  const [upcomingBookings, setUpcomingBookings] = useState([])

  useEffect(() => {
    let cancelled = false

    async function loadDashboard() {
      const now = new Date()
      const horizon = new Date(now)
      horizon.setDate(horizon.getDate() + 60)

      // Technicians have no access to invoicing, so those calls are skipped
      // rather than fired and rejected with a 403.
      const noAccess = () => Promise.reject(new Error('Invoices are not available to your role'))
      const invoiceRequests = canSeeInvoices
        ? [getInvoiceSummary(), listInvoices({ page: 1, page_size: 5 }), fetchChartInvoices()]
        : [noAccess(), noAccess(), noAccess()]

      const [customers, jobs, bookings, invoiceSummary, latestInvoices, chartInvoices] =
        await Promise.allSettled([
          listCustomers({ page: 1, page_size: 1, is_active: true }),
          listJobs({ page: 1, page_size: 1, status: JOB_STATUS.PENDING }),
          getCalendarEvents(now.toISOString(), horizon.toISOString()),
          ...invoiceRequests,
        ])

      if (cancelled) return

      setCustomerCount(customers.status === 'fulfilled' ? customers.value.total : null)
      setPendingJobCount(jobs.status === 'fulfilled' ? jobs.value.total : null)

      // Active bookings = anything still scheduled or confirmed in the window.
      if (bookings.status === 'fulfilled' && Array.isArray(bookings.value)) {
        const events = bookings.value
        const active = events.filter((event) => {
          const status = event.extendedProps?.status
          return status === BOOKING_STATUS.SCHEDULED || status === BOOKING_STATUS.CONFIRMED
        })
        setActiveBookingCount(active.length)
        setUpcomingBookings(active.slice(0, 5))
      } else {
        setActiveBookingCount(null)
        setUpcomingBookings([])
      }

      setSummary(invoiceSummary.status === 'fulfilled' ? invoiceSummary.value : null)
      setRecentInvoices(
        latestInvoices.status === 'fulfilled' ? (latestInvoices.value.items ?? []) : [],
      )

      if (chartInvoices.status === 'fulfilled') {
        setRevenue(buildRevenueSeries(chartInvoices.value))
        setRevenueFailed(false)
      } else {
        setRevenue(buildRevenueSeries([]))
        setRevenueFailed(true)
      }

      setLoading(false)
    }

    void loadDashboard()
    return () => {
      cancelled = true
    }
  }, [canSeeInvoices])

  const hasRevenue = useMemo(
    () => revenue.some((row) => row.invoiced > 0 || row.collected > 0),
    [revenue],
  )

  const dash = (value) => (value === null || value === undefined ? '--' : String(value))
  const money = (value) =>
    value === null || value === undefined ? '--' : formatCurrency(value)

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <>
            {greeting()}
            {user ? `, ${user.full_name.split(' ')[0]}` : ''}
          </>
        }
        description={
          <>
            {user ? `Signed in as ${ROLE_LABELS[user.role]}.` : ''} Here is where things stand today.
          </>
        }
      />

      {/* Row 1 - stat cards ---------------------------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Total customers"
          value={dash(customerCount)}
          icon={Users}
          hint="Active records in your database"
          to="/customers"
          linkLabel="View customers"
          loading={loading}
        />
        <StatCard
          label="Active bookings"
          value={dash(activeBookingCount)}
          icon={CalendarClock}
          hint="Scheduled or confirmed in the next 60 days"
          to="/bookings?view=calendar"
          linkLabel="Open the calendar"
          loading={loading}
        />
        <StatCard
          label="Pending jobs"
          value={dash(pendingJobCount)}
          icon={ClipboardList}
          hint="Waiting on a technician to start"
          to="/jobs"
          linkLabel="View jobs"
          loading={loading}
        />
        <StatCard
          label="Outstanding"
          value={money(summary?.total_outstanding)}
          icon={Wallet}
          hint="Invoiced but not yet collected"
          to={canSeeInvoices ? '/invoices' : undefined}
          linkLabel="View invoices"
          loading={loading}
        />
        <StatCard
          label="Overdue"
          value={money(summary?.total_overdue)}
          icon={AlertTriangle}
          hint={
            summary?.overdue_count
              ? `${summary.overdue_count} invoice(s) past their due date`
              : 'Nothing past its due date'
          }
          to={canSeeInvoices ? '/invoices?overdue=1' : undefined}
          linkLabel="Chase payments"
          loading={loading}
          tone={(summary?.total_overdue ?? 0) > 0 ? 'red' : 'default'}
        />
      </div>

      {/* Row 2 - revenue chart -------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Revenue</CardTitle>
          <CardDescription>
            Invoiced against collected over the last {CHART_MONTHS} months.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-[300px] animate-pulse rounded-md bg-muted" />
          ) : !canSeeInvoices || revenueFailed ? (
            <div className="flex h-[300px] flex-col items-center justify-center gap-2 text-center">
              <Receipt className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                {canSeeInvoices
                  ? 'Revenue figures are unavailable right now.'
                  : 'Revenue figures are only visible to office staff and admins.'}
              </p>
            </div>
          ) : !hasRevenue ? (
            <div className="flex h-[300px] flex-col items-center justify-center gap-2 text-center">
              <Receipt className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                No invoices raised in the last {CHART_MONTHS} months.
              </p>
            </div>
          ) : (
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenue} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 12, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={{ stroke: '#e2e8f0' }}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `£${Number(value).toLocaleString('en-GB')}`}
                    width={80}
                  />
                  <Tooltip
                    formatter={(value, name) => [formatCurrency(value), name]}
                    contentStyle={{
                      borderRadius: 8,
                      border: '1px solid #e2e8f0',
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="invoiced" name="Invoiced" fill="#64748b" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="collected" name="Collected" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Row 3 - recent invoices + upcoming bookings ---------------------- */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>Recent invoices</CardTitle>
              <CardDescription>The five most recently issued.</CardDescription>
            </div>
            {canSeeInvoices ? (
              <Button asChild variant="link" size="sm" className="h-auto p-0">
                <Link to="/invoices">
                  View all
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="space-y-3 p-6">
                <RowSkeleton className="w-full" />
                <RowSkeleton className="w-5/6" />
                <RowSkeleton className="w-4/6" />
              </div>
            ) : recentInvoices.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                {canSeeInvoices ? 'No invoices raised yet.' : '--'}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-16 text-right">&nbsp;</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentInvoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-medium text-foreground">
                        {invoice.invoice_number}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {invoice.customer_name ?? '--'}
                      </TableCell>
                      <TableCell className="text-right text-foreground">
                        {formatCurrency(invoice.total)}
                      </TableCell>
                      <TableCell>
                        <InvoiceStatusBadge status={invoice.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="link" size="sm" className="h-auto p-0">
                          <Link to={`/invoices/${invoice.id}`}>View</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>Upcoming bookings</CardTitle>
              <CardDescription>The next five service visits.</CardDescription>
            </div>
            <Button asChild variant="link" size="sm" className="h-auto p-0">
              <Link to="/bookings">
                View all
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-4">
                <RowSkeleton className="w-full" />
                <RowSkeleton className="w-5/6" />
                <RowSkeleton className="w-4/6" />
              </div>
            ) : upcomingBookings.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Nothing scheduled in the next 60 days.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {upcomingBookings.map((event) => (
                  <li key={event.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                      <CalendarClock className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">
                        {formatBookingDateTime(event.start)}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {event.extendedProps?.customer_name ?? 'Unknown customer'} &middot;{' '}
                        {event.extendedProps?.service_type ?? '--'} &middot;{' '}
                        {event.extendedProps?.technician_name ?? 'Unassigned'}
                      </p>
                    </div>
                    <Button asChild variant="link" size="sm" className="h-auto shrink-0 p-0">
                      <Link to={`/bookings/${event.id}`}>Open</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default DashboardPage
