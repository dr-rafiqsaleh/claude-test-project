import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Banknote,
  Download,
  Eye,
  MoreHorizontal,
  Pencil,
  Plus,
  Receipt,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react'

import { downloadInvoicePdf } from '@/api/invoices'
import { InvoiceStatusBadge } from '@/components/invoices/InvoiceStatusBadge'
import { PaymentDialog } from '@/components/invoices/PaymentDialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState, PageHeader, Pagination, RefreshButton } from '@/components/ui/page'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { LoadingState } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toastError, toastSuccess } from '@/components/ui/use-toast'
import { useDebounce } from '@/hooks/useDebounce'
import { useInvoices, useInvoiceSummary } from '@/hooks/useInvoices'
import { toApiError } from '@/lib/api'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import {
  ALL_INVOICE_STATUSES,
  DELETABLE_INVOICE_STATUSES,
  EDITABLE_INVOICE_STATUSES,
  INVOICE_STATUS,
  INVOICE_STATUS_LABELS,
  PAYABLE_INVOICE_STATUSES,
  TERMINAL_INVOICE_STATUSES,
} from '@/lib/constants'

const PAGE_SIZE = 20
const ALL = '__all__'

/** One chip in the revenue summary bar. */
function StatChip({ label, value, loading, tone = 'default' }) {
  const tones = {
    default: 'text-foreground',
    emerald: 'text-primary',
    amber: 'text-amber-700 dark:text-amber-400',
    red: 'text-destructive',
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {loading ? (
        <div className="mt-2 h-7 w-24 animate-pulse rounded bg-muted" />
      ) : (
        <p className={cn('mt-1 text-xl font-semibold tracking-tight', tones[tone])}>{value}</p>
      )}
    </div>
  )
}

export function InvoicesPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const canWrite = useAuthStore((state) => state.canWrite())
  const canCancel = useAuthStore((state) => state.can('invoices.cancel'))

  const customerId = searchParams.get('customer_id') ?? ''

  const [search, setSearch] = useState('')
  // A status can arrive in the link, e.g. from Today's "Ready to send".
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get('status') || ALL)
  // The dashboard's "Overdue" card deep-links here with ?overdue=1.
  const [overdueOnly, setOverdueOnly] = useState(searchParams.get('overdue') === '1')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [pendingCancel, setPendingCancel] = useState(null)
  const [paymentFor, setPaymentFor] = useState(null)
  const [busy, setBusy] = useState(false)
  const [downloadingId, setDownloadingId] = useState(null)

  const debouncedSearch = useDebounce(search, 350)

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, statusFilter, overdueOnly, dateFrom, dateTo, customerId])

  const params = useMemo(() => {
    const next = { page, page_size: PAGE_SIZE }
    if (debouncedSearch.trim()) next.q = debouncedSearch.trim()
    if (statusFilter !== ALL) next.status = statusFilter
    if (overdueOnly) next.overdue_only = true
    if (dateFrom) next.date_from = new Date(`${dateFrom}T00:00:00`).toISOString()
    if (dateTo) next.date_to = new Date(`${dateTo}T23:59:59`).toISOString()
    if (customerId) next.customer_id = customerId
    return next
  }, [page, debouncedSearch, statusFilter, overdueOnly, dateFrom, dateTo, customerId])

  const { invoices, total, totalPages, loading, error, refetch, remove, updateStatus, recordPayment } =
    useInvoices(params)
  const { summary, loading: summaryLoading, refetch: refetchSummary } = useInvoiceSummary()

  async function handleDownload(invoice) {
    setDownloadingId(invoice.id)
    try {
      await downloadInvoicePdf(invoice.id, invoice.invoice_number)
    } catch (err) {
      toastError('Could not download the invoice', toApiError(err).message)
    } finally {
      setDownloadingId(null)
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setBusy(true)
    try {
      await remove(pendingDelete.id)
      toastSuccess('Invoice deleted', `${pendingDelete.invoice_number} was removed.`)
      setPendingDelete(null)
      await refetchSummary()
    } catch (err) {
      toastError('Could not delete the invoice', toApiError(err).message)
    } finally {
      setBusy(false)
    }
  }

  async function confirmCancel() {
    if (!pendingCancel) return
    setBusy(true)
    try {
      await updateStatus(pendingCancel.id, INVOICE_STATUS.CANCELLED)
      toastSuccess('Invoice cancelled', `${pendingCancel.invoice_number} was cancelled.`)
      setPendingCancel(null)
      await refetchSummary()
    } catch (err) {
      toastError('Could not cancel the invoice', toApiError(err).message)
    } finally {
      setBusy(false)
    }
  }

  async function submitPayment(payload) {
    if (!paymentFor) return
    try {
      const updated = await recordPayment(paymentFor.id, payload)
      toastSuccess(
        'Payment recorded',
        `${formatCurrency(payload.amount)} received against ${paymentFor.invoice_number}. ` +
          `Balance due ${formatCurrency(updated?.amount_due ?? 0)}.`,
      )
      await refetchSummary()
    } catch (err) {
      throw new Error(toApiError(err, 'Could not record this payment').message)
    }
  }

  const isFiltered =
    Boolean(debouncedSearch.trim()) ||
    statusFilter !== ALL ||
    overdueOnly ||
    Boolean(dateFrom) ||
    Boolean(dateTo) ||
    Boolean(customerId)

  function clearFilters() {
    setSearch('')
    setStatusFilter(ALL)
    setOverdueOnly(false)
    setDateFrom('')
    setDateTo('')
    navigate('/invoices')
  }


  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoices"
        description="Bill completed work, chase what is owing and record payments as they land."
        actions={
          <>
            <RefreshButton
              loading={loading || summaryLoading}
              onRefresh={() => Promise.all([refetch(), refetchSummary()])}
            />
            {canWrite ? (
              <Button asChild>
                <Link to="/invoices/new">
                  <Plus className="h-4 w-4" />
                  New invoice
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {/* Revenue summary ------------------------------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatChip
          label="Total invoiced"
          value={formatCurrency(summary?.total_invoiced ?? 0)}
          loading={summaryLoading}
        />
        <StatChip
          label="Outstanding"
          value={formatCurrency(summary?.total_outstanding ?? 0)}
          loading={summaryLoading}
          tone="amber"
        />
        <StatChip
          label="Overdue"
          value={formatCurrency(summary?.total_overdue ?? 0)}
          loading={summaryLoading}
          tone={(summary?.total_overdue ?? 0) > 0 ? 'red' : 'default'}
        />
        <StatChip
          label="Collected this month"
          value={formatCurrency(summary?.collected_this_month ?? 0)}
          loading={summaryLoading}
          tone="emerald"
        />
      </div>

      {/* Filters ---------------------------------------------------------- */}
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setStatusFilter(ALL)}
              className={cn(
                'rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
                statusFilter === ALL
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80',
              )}
            >
              All
            </button>
            {ALL_INVOICE_STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
                  statusFilter === status
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80',
                )}
              >
                {INVOICE_STATUS_LABELS[status]}
                {summary?.invoice_count_by_status?.[status] ? (
                  <span className="ml-1.5 text-xs opacity-70">
                    {summary.invoice_count_by_status[status]}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by invoice number or customer name..."
                className="pl-9"
                aria-label="Search invoices"
              />
            </div>

            <div className="flex items-end gap-2">
              <div>
                <label
                  htmlFor="invoice-date-from"
                  className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  Issued from
                </label>
                <Input
                  id="invoice-date-from"
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  className="w-[150px]"
                />
              </div>
              <div>
                <label
                  htmlFor="invoice-date-to"
                  className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  Issued to
                </label>
                <Input
                  id="invoice-date-to"
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  className="w-[150px]"
                />
              </div>
            </div>

            <label
              htmlFor="invoice-overdue-only"
              className={cn(
                'flex h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors',
                overdueOnly
                  ? 'border-destructive/30 bg-destructive/10 text-destructive'
                  : 'border-input text-muted-foreground hover:bg-muted/50',
              )}
            >
              <input
                id="invoice-overdue-only"
                type="checkbox"
                checked={overdueOnly}
                onChange={(event) => setOverdueOnly(event.target.checked)}
                className="h-4 w-4 rounded border-input text-destructive focus:ring-destructive"
              />
              Overdue only
            </label>
          </div>

          {customerId ? (
            <div className="flex items-center gap-2">
              <Badge variant="info">Filtered to one customer</Badge>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => navigate('/invoices')}
              >
                Show all invoices
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Table ------------------------------------------------------------ */}
      <Card className="overflow-hidden">
        {loading ? (
          <LoadingState message="Loading invoices..." />
        ) : error ? (
          <ErrorState title="Could not load invoices" message={error.message} onRetry={refetch} />
        ) : invoices.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={isFiltered ? 'No invoices match your filters' : 'No invoices yet'}
            description={isFiltered
            ? 'Try a different search term or clear the filters.'
            : 'Invoices are raised automatically when a job is completed, or you can create one by hand.'}
            action={isFiltered ? (
              <Button variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : canWrite ? (
              <Button asChild>
                <Link to="/invoices/new">
                  <Plus className="h-4 w-4" />
                  New invoice
                </Link>
              </Button>
            ) : null}
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="hidden lg:table-cell">Report #</TableHead>
                  <TableHead className="hidden md:table-cell">Issued</TableHead>
                  <TableHead className="hidden md:table-cell">Due</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Paid</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => {
                  const isDraft = invoice.status === INVOICE_STATUS.DRAFT
                  const editable = EDITABLE_INVOICE_STATUSES.includes(invoice.status)
                  const deletable = DELETABLE_INVOICE_STATUSES.includes(invoice.status)
                  const payable = PAYABLE_INVOICE_STATUSES.includes(invoice.status)
                  const cancellable = !TERMINAL_INVOICE_STATUSES.includes(invoice.status)
                  const overdue =
                    invoice.is_overdue || invoice.status === INVOICE_STATUS.OVERDUE

                  return (
                    <TableRow
                      key={invoice.id}
                      className={cn(
                        'cursor-pointer',
                        overdue ? 'border-l-4 border-l-red-400' : '',
                      )}
                      onClick={() => navigate(`/invoices/${invoice.id}`)}
                    >
                      <TableCell className="font-medium text-foreground">
                        {invoice.invoice_number}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {invoice.customer_name ?? '--'}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">
                        {invoice.job_number ?? '--'}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        {formatDate(invoice.issue_date)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'hidden md:table-cell',
                          overdue
                            ? 'font-medium text-destructive'
                            : 'text-muted-foreground',
                        )}
                      >
                        {formatDate(invoice.due_date)}
                      </TableCell>
                      <TableCell className="text-right font-medium text-foreground">
                        {formatCurrency(invoice.total)}
                      </TableCell>
                      <TableCell className="hidden text-right text-primary lg:table-cell">
                        {formatCurrency(invoice.amount_paid)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right font-medium',
                          invoice.amount_due > 0
                            ? 'text-destructive'
                            : 'text-primary',
                        )}
                      >
                        {formatCurrency(invoice.amount_due)}
                      </TableCell>
                      <TableCell>
                        <InvoiceStatusBadge status={invoice.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div onClick={(event) => event.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                aria-label="Row actions"
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onSelect={() => navigate(`/invoices/${invoice.id}`)}
                              >
                                <Eye className="h-4 w-4" />
                                View details
                              </DropdownMenuItem>

                              {canWrite && editable ? (
                                <DropdownMenuItem
                                  onSelect={() => navigate(`/invoices/${invoice.id}/edit`)}
                                >
                                  <Pencil className="h-4 w-4" />
                                  Edit
                                </DropdownMenuItem>
                              ) : null}

                              <DropdownMenuItem
                                disabled={downloadingId === invoice.id}
                                onSelect={(event) => {
                                  event.preventDefault()
                                  void handleDownload(invoice)
                                }}
                              >
                                <Download className="h-4 w-4" />
                                {downloadingId === invoice.id ? 'Preparing...' : 'Download PDF'}
                              </DropdownMenuItem>

                              {canWrite && payable ? (
                                <DropdownMenuItem onSelect={() => setPaymentFor(invoice)}>
                                  <Banknote className="h-4 w-4" />
                                  Record payment
                                </DropdownMenuItem>
                              ) : null}

                              {canCancel && (cancellable || deletable) ? (
                                <DropdownMenuSeparator />
                              ) : null}

                              {canCancel && cancellable ? (
                                <DropdownMenuItem
                                  onSelect={() => setPendingCancel(invoice)}
                                  className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                                >
                                  <XCircle className="h-4 w-4" />
                                  Cancel invoice
                                </DropdownMenuItem>
                              ) : null}

                              {canCancel && isDraft ? (
                                <DropdownMenuItem
                                  onSelect={() => setPendingDelete(invoice)}
                                  className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Delete
                                </DropdownMenuItem>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            <Pagination page={page} totalPages={totalPages} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
          </>
        )}
      </Card>

      <PaymentDialog
        open={paymentFor !== null}
        onOpenChange={(open) => {
          if (!open) setPaymentFor(null)
        }}
        invoice={paymentFor}
        onSubmit={submitPayment}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `${pendingDelete.invoice_number} will be permanently deleted. Only draft invoices can be removed, and this cannot be undone.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-destructive hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault()
                void confirmDelete()
              }}
            >
              {busy ? 'Deleting...' : 'Delete invoice'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingCancel !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setPendingCancel(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingCancel
                ? `${pendingCancel.invoice_number} will be marked as cancelled. Cancelled invoices drop out of your outstanding balance and cannot be reopened.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep invoice</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-destructive hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault()
                void confirmCancel()
              }}
            >
              {busy ? 'Cancelling...' : 'Cancel invoice'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default InvoicesPage
