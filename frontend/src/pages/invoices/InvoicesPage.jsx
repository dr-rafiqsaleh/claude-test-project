import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertCircle,
  Banknote,
  ChevronLeft,
  ChevronRight,
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
    default: 'text-slate-900 dark:text-slate-100',
    emerald: 'text-emerald-700 dark:text-emerald-400',
    amber: 'text-amber-700 dark:text-amber-400',
    red: 'text-red-600 dark:text-red-400',
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/40">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      {loading ? (
        <div className="mt-2 h-7 w-24 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
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
  const isAdmin = useAuthStore((state) => state.isAdmin())

  const customerId = searchParams.get('customer_id') ?? ''

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState(ALL)
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

  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(page * PAGE_SIZE, total)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Invoices
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Bill completed work, chase what is owing and record payments as they land.
          </p>
        </div>

        {canWrite ? (
          <Button asChild>
            <Link to="/invoices/new">
              <Plus className="h-4 w-4" />
              New invoice
            </Link>
          </Button>
        ) : null}
      </div>

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
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
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
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
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
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
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
                  className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
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
                  className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
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
                  ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
                  : 'border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
              )}
            >
              <input
                id="invoice-overdue-only"
                type="checkbox"
                checked={overdueOnly}
                onChange={(event) => setOverdueOnly(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-red-600 focus:ring-red-600"
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
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <AlertCircle className="h-10 w-10 text-red-500" />
            <div>
              <p className="font-medium text-slate-900 dark:text-slate-100">
                Could not load invoices
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{error.message}</p>
            </div>
            <Button variant="outline" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        ) : invoices.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
              <Receipt className="h-6 w-6 text-slate-400" />
            </div>
            <div>
              <p className="font-medium text-slate-900 dark:text-slate-100">
                {isFiltered ? 'No invoices match your filters' : 'No invoices yet'}
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {isFiltered
                  ? 'Try a different search term or clear the filters.'
                  : 'Invoices are raised automatically when a job is completed, or you can create one by hand.'}
              </p>
            </div>
            {isFiltered ? (
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
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="hidden lg:table-cell">Job #</TableHead>
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
                      <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                        {invoice.invoice_number}
                      </TableCell>
                      <TableCell className="text-slate-600 dark:text-slate-400">
                        {invoice.customer_name ?? '--'}
                      </TableCell>
                      <TableCell className="hidden text-slate-600 dark:text-slate-400 lg:table-cell">
                        {invoice.job_number ?? '--'}
                      </TableCell>
                      <TableCell className="hidden text-slate-600 dark:text-slate-400 md:table-cell">
                        {formatDate(invoice.issue_date)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'hidden md:table-cell',
                          overdue
                            ? 'font-medium text-red-600 dark:text-red-400'
                            : 'text-slate-600 dark:text-slate-400',
                        )}
                      >
                        {formatDate(invoice.due_date)}
                      </TableCell>
                      <TableCell className="text-right font-medium text-slate-900 dark:text-slate-100">
                        {formatCurrency(invoice.total)}
                      </TableCell>
                      <TableCell className="hidden text-right text-emerald-700 lg:table-cell dark:text-emerald-400">
                        {formatCurrency(invoice.amount_paid)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right font-medium',
                          invoice.amount_due > 0
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-emerald-700 dark:text-emerald-400',
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

                              {isAdmin && (cancellable || deletable) ? (
                                <DropdownMenuSeparator />
                              ) : null}

                              {isAdmin && cancellable ? (
                                <DropdownMenuItem
                                  onSelect={() => setPendingCancel(invoice)}
                                  className="text-red-600 focus:bg-red-50 focus:text-red-700 dark:text-red-400 dark:focus:bg-red-950"
                                >
                                  <XCircle className="h-4 w-4" />
                                  Cancel invoice
                                </DropdownMenuItem>
                              ) : null}

                              {isAdmin && isDraft ? (
                                <DropdownMenuItem
                                  onSelect={() => setPendingDelete(invoice)}
                                  className="text-red-600 focus:bg-red-50 focus:text-red-700 dark:text-red-400 dark:focus:bg-red-950"
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

            <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 sm:flex-row dark:border-slate-800">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Showing <span className="font-medium">{rangeStart}</span>-
                <span className="font-medium">{rangeEnd}</span> of{' '}
                <span className="font-medium">{total}</span>
              </p>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <span className="px-2 text-sm text-slate-600 dark:text-slate-400">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
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
              className="bg-red-600 hover:bg-red-700"
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
              className="bg-red-600 hover:bg-red-700"
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
