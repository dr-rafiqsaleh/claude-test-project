import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  CalendarClock,
  Check,
  Download,
  MapPin,
  Pencil,
  Phone,
  Send,
  StickyNote,
  User as UserIcon,
  X,
} from 'lucide-react'

import { downloadQuotePdf, updateQuoteStatus } from '@/api/quotes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { LoadingState, Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { toastError, toastSuccess } from '@/components/ui/use-toast'
import { useQuote } from '@/hooks/useQuotes'
import { toApiError } from '@/lib/api'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { QUOTE_STATUS_BADGE, QUOTE_STATUS_LABELS, QuoteStatus } from '@/lib/constants'

function Field({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 dark:bg-slate-800">
        <Icon className="h-4 w-4 text-slate-500 dark:text-slate-400" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {label}
        </p>
        <p className="break-words text-sm font-medium text-slate-900 dark:text-slate-100">{value}</p>
      </div>
    </div>
  )
}

export function QuoteDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const canWrite = useAuthStore((state) => state.canWrite())
  const { quote, loading, error, refetch, setQuote } = useQuote(id)

  const [downloading, setDownloading] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectError, setRejectError] = useState(null)

  async function handleDownload() {
    if (!quote) return
    setDownloading(true)
    try {
      await downloadQuotePdf(quote.id, quote.quote_number)
    } catch (err) {
      toastError('Could not download PDF', toApiError(err).message)
    } finally {
      setDownloading(false)
    }
  }

  async function changeStatus(status, reason) {
    if (!quote) return
    setTransitioning(true)
    try {
      const updated = await updateQuoteStatus(quote.id, status, reason)
      setQuote(updated)
      toastSuccess('Quote updated', `${quote.quote_number} is now ${QUOTE_STATUS_LABELS[status].toLowerCase()}.`)
      return true
    } catch (err) {
      const apiError = toApiError(err, 'Could not update this quote')
      toastError('Update failed', apiError.message)
      setRejectError(apiError.message)
      return false
    } finally {
      setTransitioning(false)
    }
  }

  async function submitRejection() {
    setRejectError(null)
    if (!rejectReason.trim()) {
      setRejectError('Please give a reason for rejecting this quote.')
      return
    }
    const ok = await changeStatus(QuoteStatus.REJECTED, rejectReason.trim())
    if (ok) {
      setRejectOpen(false)
      setRejectReason('')
    }
  }

  if (loading) {
    return <LoadingState message="Loading quote..." />
  }

  if (error || !quote) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" className="-ml-2" onClick={() => navigate('/quotes')}>
          <ArrowLeft className="h-4 w-4" />
          Back to quotes
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <AlertCircle className="h-10 w-10 text-red-500" />
            <div>
              <p className="font-medium text-slate-900 dark:text-slate-100">Quote not found</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {error?.message ?? 'This quote may have been removed.'}
              </p>
            </div>
            <Button variant="outline" onClick={() => void refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const isDraft = quote.status === QuoteStatus.DRAFT
  const isSent = quote.status === QuoteStatus.SENT
  const isAccepted = quote.status === QuoteStatus.ACCEPTED

  return (
    <div className="space-y-6">
      <Button variant="ghost" className="-ml-2" onClick={() => navigate('/quotes')}>
        <ArrowLeft className="h-4 w-4" />
        Back to quotes
      </Button>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
              {quote.quote_number}
            </h1>
            <Badge variant={QUOTE_STATUS_BADGE[quote.status]}>
              {QUOTE_STATUS_LABELS[quote.status]}
            </Badge>
            {quote.converted_to_booking ? <Badge variant="info">Converted</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Created {formatDateTime(quote.created_at)}
            {quote.sent_at ? ` · Sent ${formatDateTime(quote.sent_at)}` : ''}
            {quote.accepted_at ? ` · Accepted ${formatDateTime(quote.accepted_at)}` : ''}
            {quote.rejected_at ? ` · Rejected ${formatDateTime(quote.rejected_at)}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={downloading} onClick={() => void handleDownload()}>
            {downloading ? <Spinner size="sm" /> : <Download className="h-4 w-4" />}
            {downloading ? 'Preparing...' : 'Download PDF'}
          </Button>

          {canWrite && isDraft ? (
            <Button asChild variant="outline">
              <Link to={`/quotes/${quote.id}/edit`}>
                <Pencil className="h-4 w-4" />
                Edit
              </Link>
            </Button>
          ) : null}

          {canWrite && isDraft ? (
            <Button disabled={transitioning} onClick={() => void changeStatus(QuoteStatus.SENT)}>
              <Send className="h-4 w-4" />
              Mark as sent
            </Button>
          ) : null}

          {canWrite && isSent ? (
            <>
              <Button disabled={transitioning} onClick={() => void changeStatus(QuoteStatus.ACCEPTED)}>
                <Check className="h-4 w-4" />
                Accept
              </Button>
              <Button
                variant="destructive"
                disabled={transitioning}
                onClick={() => {
                  setRejectError(null)
                  setRejectOpen(true)
                }}
              >
                <X className="h-4 w-4" />
                Reject
              </Button>
            </>
          ) : null}

          {canWrite && isAccepted && !quote.converted_to_booking ? (
            <Button variant="outline" onClick={() => navigate(`/bookings/new?quote_id=${quote.id}`)}>
              <CalendarClock className="h-4 w-4" />
              Convert to booking
            </Button>
          ) : null}

          {quote.converted_to_booking && quote.booking_id ? (
            <Button asChild variant="outline">
              <Link to={`/bookings/${quote.booking_id}`}>
                <CalendarClock className="h-4 w-4" />
                View booking
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Line items</CardTitle>
              <CardDescription>Everything included in this quote.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead className="hidden sm:table-cell">Pest type</TableHead>
                    <TableHead className="hidden md:table-cell">Service</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit price</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quote.items.map((item, index) => (
                    <TableRow key={`${item.description}-${index}`}>
                      <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                        {item.description}
                      </TableCell>
                      <TableCell className="hidden text-slate-600 dark:text-slate-400 sm:table-cell">
                        {item.pest_type || '--'}
                      </TableCell>
                      <TableCell className="hidden text-slate-600 dark:text-slate-400 md:table-cell">
                        {item.service_type || '--'}
                      </TableCell>
                      <TableCell className="text-right text-slate-600 dark:text-slate-400">
                        {item.quantity} {item.unit}
                      </TableCell>
                      <TableCell className="text-right text-slate-600 dark:text-slate-400">
                        {formatCurrency(item.unit_price)}
                      </TableCell>
                      <TableCell className="text-right font-medium text-slate-900 dark:text-slate-100">
                        {formatCurrency(item.line_total ?? item.quantity * item.unit_price)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex justify-end border-t border-slate-200 p-4 dark:border-slate-800">
                <dl className="w-full max-w-xs space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Subtotal</dt>
                    <dd className="font-medium text-slate-900 dark:text-slate-100">
                      {formatCurrency(quote.subtotal)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">
                      VAT ({Math.round(quote.tax_rate * 100)}%)
                    </dt>
                    <dd className="font-medium text-slate-900 dark:text-slate-100">
                      {formatCurrency(quote.tax_amount)}
                    </dd>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-base">
                    <dt className="font-semibold text-slate-900 dark:text-slate-100">Total</dt>
                    <dd className="font-semibold text-emerald-700 dark:text-emerald-400">
                      {formatCurrency(quote.total)}
                    </dd>
                  </div>
                </dl>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notes &amp; terms</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <Field
                icon={StickyNote}
                label="Notes"
                value={quote.notes?.trim() || 'No notes recorded.'}
              />
              <Separator />
              <Field
                icon={StickyNote}
                label="Terms"
                value={quote.terms?.trim() || 'No terms recorded.'}
              />
              {quote.rejection_reason ? (
                <>
                  <Separator />
                  <Field icon={X} label="Rejection reason" value={quote.rejection_reason} />
                </>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <Field icon={UserIcon} label="Name" value={quote.customer_name ?? '--'} />
              <Field icon={Phone} label="Phone" value={quote.customer_phone ?? '--'} />
              <Field icon={MapPin} label="Address" value={quote.customer_address ?? '--'} />
              <Button asChild variant="outline" size="sm" className="w-full">
                <Link to={`/customers/${quote.customer_id}`}>View customer</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dates</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <Field icon={CalendarClock} label="Created" value={formatDate(quote.created_at)} />
              <Field icon={CalendarClock} label="Valid until" value={formatDate(quote.valid_until)} />
              <Field icon={CalendarClock} label="Last updated" value={formatDate(quote.updated_at)} />
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog
        open={rejectOpen}
        onOpenChange={(open) => {
          if (!transitioning) {
            setRejectOpen(open)
            if (!open) {
              setRejectReason('')
              setRejectError(null)
            }
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this quote</DialogTitle>
            <DialogDescription>
              Record why {quote.quote_number} was rejected. This is kept with the quote for future
              reference.
            </DialogDescription>
          </DialogHeader>

          {rejectError ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{rejectError}</span>
            </div>
          ) : null}

          <Textarea
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            rows={4}
            placeholder="Customer went with another provider."
            hasError={Boolean(rejectError)}
            aria-label="Rejection reason"
          />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={transitioning}
              onClick={() => setRejectOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={transitioning}
              onClick={() => void submitRejection()}
            >
              {transitioning ? <Spinner size="sm" className="text-white" /> : null}
              {transitioning ? 'Rejecting...' : 'Reject quote'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default QuoteDetailPage
