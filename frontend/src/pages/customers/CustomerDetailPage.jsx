import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { format } from 'date-fns'
import {
  ArrowRight,
  CalendarDays,
  CalendarPlus,
  FileText,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Receipt,
  RotateCcw,
  Smartphone,
  StickyNote,
} from 'lucide-react'

import { listBookings } from '@/api/bookings'
import { updateCustomer } from '@/api/customers'
import { listInvoices } from '@/api/invoices'
import { listQuotes } from '@/api/quotes'
import { BookingStatusBadge } from '@/components/bookings/BookingStatusBadge'
import { EmailHistory } from '@/components/email/EmailHistory'
import { InvoiceStatusBadge } from '@/components/invoices/InvoiceStatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DetailField, ErrorState, PageHeader } from '@/components/ui/page'
import { LoadingState } from '@/components/ui/spinner'
import { toastError, toastSuccess } from '@/components/ui/use-toast'
import { useCustomer } from '@/hooks/useCustomers'
import { toApiError } from '@/lib/api'
import { QUOTE_STATUS_BADGE, QUOTE_STATUS_LABELS } from '@/lib/constants'
import { formatAddress, formatCurrency, formatDate } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'

/** How many of each record the hub shows before "View all". */
const PREVIEW = 5

/**
 * One customer's visits, quotes and invoices, fetched together. Technicians
 * have no access to money, so quotes and invoices are skipped for them.
 */
function useCustomerHistory(customerId, includeMoney) {
  const [history, setHistory] = useState({ loading: true })

  useEffect(() => {
    if (!customerId) return undefined
    let cancelled = false
    const none = Promise.resolve(null)
    const params = { customer_id: customerId, page_size: 50 }

    Promise.allSettled([
      listBookings(params),
      includeMoney ? listQuotes(params) : none,
      includeMoney ? listInvoices(params) : none,
    ]).then(([visits, quotes, invoices]) => {
      if (cancelled) return
      const items = (result) => (result.status === 'fulfilled' && result.value ? result.value.items : null)
      const totals = (result) => (result.status === 'fulfilled' && result.value ? result.value.total : 0)
      setHistory({
        loading: false,
        visits: items(visits),
        visitTotal: totals(visits),
        quotes: items(quotes),
        quoteTotal: totals(quotes),
        invoices: items(invoices),
        invoiceTotal: totals(invoices),
      })
    })
    return () => {
      cancelled = true
    }
  }, [customerId, includeMoney])

  return history
}

function HistoryCard({ title, icon: Icon, total, viewAllTo, empty, action, loading, children }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <CardTitle className="text-base">{title}</CardTitle>
          {total ? <span className="text-sm text-muted-foreground">{total}</span> : null}
        </div>
        {total > PREVIEW ? (
          <Button asChild variant="link" size="sm" className="h-auto p-0">
            <Link to={viewAllTo}>
              View all
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="space-y-2 px-6 pb-6">
            <div className="h-9 animate-pulse rounded-md bg-muted" />
            <div className="h-9 animate-pulse rounded-md bg-muted" />
          </div>
        ) : children ? (
          <ul className="divide-y divide-border border-t border-border">{children}</ul>
        ) : (
          <div className="flex flex-col items-center gap-3 border-t border-border px-6 py-8 text-center">
            <p className="text-sm text-muted-foreground">{empty}</p>
            {action}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function HistoryRow({ to, primary, secondary, trailing }) {
  return (
    <li>
      <Link to={to} className="flex items-center gap-4 px-6 py-3 transition-colors duration-150 hover:bg-muted/50">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{primary}</p>
          <p className="truncate text-xs text-muted-foreground">{secondary}</p>
        </div>
        {trailing}
      </Link>
    </li>
  )
}

/** Everything about one customer in one place: contact, visits, quotes, money. */
export function CustomerDetailPage() {
  const { id } = useParams()
  const canWrite = useAuthStore((state) => state.canWrite())
  const { customer, loading, error, refetch } = useCustomer(id)
  const history = useCustomerHistory(customer?.id, canWrite)
  const [restoring, setRestoring] = useState(false)

  async function handleRestore() {
    setRestoring(true)
    try {
      await updateCustomer(customer.id, { is_active: true })
      await refetch()
      toastSuccess('Customer restored', `${customer.first_name} ${customer.last_name} is active again.`)
    } catch (err) {
      toastError('Could not restore customer', toApiError(err).message)
    } finally {
      setRestoring(false)
    }
  }

  if (loading) {
    return <LoadingState message="Loading customer..." />
  }

  if (error || !customer) {
    return (
      <div className="space-y-4">
        <PageHeader backTo="/customers" backLabel="Back to customers" title="Customer" />
        <Card>
          <ErrorState
            title="Customer not found"
            message={error?.message ?? 'This customer may have been removed.'}
            onRetry={refetch}
          />
        </Card>
      </div>
    )
  }

  const address = formatAddress(customer.address)
  const owed = (history.invoices ?? []).reduce((sum, invoice) => sum + Number(invoice.amount_due ?? 0), 0)
  const visits = history.visits ?? []
  const quotes = history.quotes ?? []
  const invoices = history.invoices ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        backTo="/customers"
        backLabel="Back to customers"
        title={`${customer.first_name} ${customer.last_name}`}
        badge={
          <>
            {!customer.is_active ? <Badge variant="secondary">Archived</Badge> : null}
            {owed > 0 ? <Badge variant="warning">Owes {formatCurrency(owed)}</Badge> : null}
          </>
        }
        description={`Customer since ${formatDate(customer.created_at)}`}
        actions={
          canWrite ? (
            <>
              {!customer.is_active ? (
                <Button variant="outline" disabled={restoring} onClick={() => void handleRestore()}>
                  <RotateCcw className="h-4 w-4" />
                  {restoring ? 'Restoring...' : 'Restore'}
                </Button>
              ) : null}
              <Button asChild variant="outline">
                <Link to={`/customers/${customer.id}/edit`}>
                  <Pencil className="h-4 w-4" />
                  Edit
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to={`/quotes/new?customer_id=${customer.id}`}>
                  <FileText className="h-4 w-4" />
                  New quote
                </Link>
              </Button>
              <Button asChild>
                <Link to={`/bookings/new?customer_id=${customer.id}`}>
                  <CalendarPlus className="h-4 w-4" />
                  Book a job
                </Link>
              </Button>
            </>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="h-fit">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Contact</CardTitle>
            <CardDescription>Tap a number to call.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <DetailField icon={Phone} label="Phone" value={customer.phone} href={`tel:${customer.phone.replace(/\s/g, '')}`} />
            {customer.mobile ? (
              <DetailField
                icon={Smartphone}
                label="Mobile"
                value={customer.mobile}
                href={`tel:${customer.mobile.replace(/\s/g, '')}`}
              />
            ) : null}
            <DetailField
              icon={Mail}
              label="Email"
              value={customer.email}
              href={customer.email ? `mailto:${customer.email}` : undefined}
            />
            <DetailField
              icon={MapPin}
              label="Address"
              value={address}
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
            />
            {customer.notes?.trim() ? <DetailField icon={StickyNote} label="Notes" value={customer.notes} /> : null}
          </CardContent>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <HistoryCard
            title="Jobs"
            icon={CalendarDays}
            total={history.visitTotal}
            viewAllTo={`/bookings?customer_id=${customer.id}`}
            loading={history.loading}
            empty="No jobs booked yet."
            action={
              canWrite ? (
                <Button asChild size="sm" variant="outline">
                  <Link to={`/bookings/new?customer_id=${customer.id}`}>Book a job</Link>
                </Button>
              ) : null
            }
          >
            {visits.length > 0
              ? visits.slice(0, PREVIEW).map((visit) => (
                  <HistoryRow
                    key={visit.id}
                    to={`/bookings/${visit.id}`}
                    primary={format(new Date(visit.scheduled_start), 'EEE d MMM yyyy, HH:mm')}
                    secondary={`${visit.service_type}${visit.technician_name ? ` · ${visit.technician_name}` : ''}`}
                    trailing={<BookingStatusBadge status={visit.status} />}
                  />
                ))
              : null}
          </HistoryCard>

          {canWrite ? (
            <>
              <HistoryCard
                title="Quotes"
                icon={FileText}
                total={history.quoteTotal}
                viewAllTo={`/quotes?customer_id=${customer.id}`}
                loading={history.loading}
                empty="No quotes yet."
                action={
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/quotes/new?customer_id=${customer.id}`}>New quote</Link>
                  </Button>
                }
              >
                {quotes.length > 0
                  ? quotes.slice(0, PREVIEW).map((quote) => (
                      <HistoryRow
                        key={quote.id}
                        to={`/quotes/${quote.id}`}
                        primary={`${quote.quote_number} · ${formatCurrency(quote.total)}`}
                        secondary={`Raised ${formatDate(quote.created_at)}`}
                        trailing={<Badge variant={QUOTE_STATUS_BADGE[quote.status]}>{QUOTE_STATUS_LABELS[quote.status]}</Badge>}
                      />
                    ))
                  : null}
              </HistoryCard>

              <HistoryCard
                title="Invoices"
                icon={Receipt}
                total={history.invoiceTotal}
                viewAllTo={`/invoices?customer_id=${customer.id}`}
                loading={history.loading}
                empty="No invoices yet. They are raised automatically when a job's report is completed."
              >
                {invoices.length > 0
                  ? invoices.slice(0, PREVIEW).map((invoice) => (
                      <HistoryRow
                        key={invoice.id}
                        to={`/invoices/${invoice.id}`}
                        primary={`${invoice.invoice_number} · ${formatCurrency(invoice.total)}`}
                        secondary={
                          Number(invoice.amount_due) > 0
                            ? `${formatCurrency(invoice.amount_due)} due ${formatDate(invoice.due_date)}`
                            : `Issued ${formatDate(invoice.issue_date)}`
                        }
                        trailing={<InvoiceStatusBadge status={invoice.status} />}
                      />
                    ))
                  : null}
              </HistoryCard>

              <EmailHistory customerId={customer.id} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default CustomerDetailPage
