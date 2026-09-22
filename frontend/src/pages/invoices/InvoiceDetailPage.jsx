import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  Banknote,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Download,
  FileText,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Send,
  User as UserIcon,
  XCircle,
} from 'lucide-react'

import { addPayment, downloadInvoicePdf, updateInvoiceStatus } from '@/api/invoices'
import { EmailDialog } from '@/components/email/EmailDialog'
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
import { Button } from '@/components/ui/button'
import { DetailField, PageHeader } from '@/components/ui/page'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { LoadingState, Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toastError, toastSuccess } from '@/components/ui/use-toast'
import { useCompanySettings } from '@/hooks/useCompanySettings'
import { useInvoice } from '@/hooks/useInvoices'
import { toApiError } from '@/lib/api'
import { cn, formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import {
  EDITABLE_INVOICE_STATUSES,
  INVOICE_STATUS,
  PAYABLE_INVOICE_STATUSES,
  PAYMENT_METHODS,
  TERMINAL_INVOICE_STATUSES,
} from '@/lib/constants'


export function InvoiceDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const canWrite = useAuthStore((state) => state.canWrite())
  const isAdmin = useAuthStore((state) => state.isAdmin())

  const { invoice, loading, error, refetch, setInvoice } = useInvoice(id)
  const settings = useCompanySettings()

  const [transitioning, setTransitioning] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)

  async function changeStatus(status, successMessage) {
    if (!invoice) return
    setTransitioning(true)
    try {
      const updated = await updateInvoiceStatus(invoice.id, status)
      setInvoice(updated)
      toastSuccess('Invoice updated', successMessage)
    } catch (err) {
      toastError('Could not update this invoice', toApiError(err).message)
    } finally {
      setTransitioning(false)
      setCancelOpen(false)
    }
  }

  async function submitPayment(payload) {
    if (!invoice) return
    try {
      const updated = await addPayment(invoice.id, payload)
      setInvoice(updated)
      toastSuccess(
        'Payment recorded',
        `${formatCurrency(payload.amount)} received. Balance due ${formatCurrency(
          updated?.amount_due ?? 0,
        )}.`,
      )
    } catch (err) {
      throw new Error(toApiError(err, 'Could not record this payment').message)
    }
  }

  async function handleDownload() {
    if (!invoice) return
    setDownloading(true)
    try {
      await downloadInvoicePdf(invoice.id, invoice.invoice_number)
      await refetch()
      toastSuccess('Invoice ready', `${invoice.invoice_number} downloaded.`)
    } catch (err) {
      toastError('Could not download the invoice', toApiError(err).message)
    } finally {
      setDownloading(false)
    }
  }

  if (loading) {
    return <LoadingState message="Loading invoice..." />
  }

  if (error || !invoice) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" className="-ml-2" onClick={() => navigate('/invoices')}>
          <ChevronRight className="h-4 w-4 rotate-180" />
          Back to invoices
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <div>
              <p className="font-medium text-foreground">Invoice not found</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {error?.message ?? 'This invoice may have been removed.'}
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

  const isDraft = invoice.status === INVOICE_STATUS.DRAFT
  const editable = EDITABLE_INVOICE_STATUSES.includes(invoice.status)
  const payable = PAYABLE_INVOICE_STATUSES.includes(invoice.status)
  const cancellable = !TERMINAL_INVOICE_STATUSES.includes(invoice.status)
  const overdue = invoice.is_overdue || invoice.status === INVOICE_STATUS.OVERDUE
  const balanceDue = Number(invoice.amount_due ?? 0)
  const payments = invoice.payments ?? []
  // VAT only shows once the business is VAT registered, or on an invoice that charged it.
  const showVat = Boolean(settings?.vat_registered) || Number(invoice.tax_amount) > 0

  return (
    <div className="space-y-6">
      <Button variant="ghost" className="-ml-2" onClick={() => navigate('/invoices')}>
        <ChevronRight className="h-4 w-4 rotate-180" />
        Back to invoices
      </Button>

      {/* Header ----------------------------------------------------------- */}
      <PageHeader
        title={invoice.invoice_number}
        badge={
          <>
            <InvoiceStatusBadge status={invoice.status} />
            {overdue && invoice.status !== INVOICE_STATUS.OVERDUE ? (
              <span className="inline-flex items-center rounded-full bg-destructive/15 px-2.5 py-0.5 text-xs font-medium text-destructive">
                Past due
              </span>
            ) : null}
          </>
        }
        description={
          <>
            {invoice.customer_name ?? 'Unknown customer'} &middot; issued{' '}
            {formatDate(invoice.issue_date)} &middot; due {formatDate(invoice.due_date)}
          </>
        }
        actions={
          <>
            {canWrite && isDraft ? (
              <Button
                disabled={transitioning}
                onClick={() =>
                  void changeStatus(
                    INVOICE_STATUS.SENT,
                    `${invoice.invoice_number} is now marked as sent.`,
                  )
                }
              >
                {transitioning ? (
                  <Spinner size="sm" className="text-current" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Send invoice
              </Button>
            ) : null}

            {canWrite && payable ? (
              <Button onClick={() => setPaymentOpen(true)}>
                <Banknote className="h-4 w-4" />
                Record payment
              </Button>
            ) : null}

            {canWrite && invoice.status !== INVOICE_STATUS.CANCELLED ? (
              <>
                <Button onClick={() => setEmailOpen(true)}>
                  <Mail className="h-4 w-4" />
                  Email invoice
                </Button>
                <EmailDialog
                  kind="invoice"
                  documentId={invoice.id}
                  open={emailOpen}
                  onOpenChange={setEmailOpen}
                  onSent={() => void refetch()}
                />
              </>
            ) : null}

            <Button variant="outline" disabled={downloading} onClick={() => void handleDownload()}>
              {downloading ? <Spinner size="sm" /> : <Download className="h-4 w-4" />}
              {downloading ? 'Preparing...' : 'Download PDF'}
            </Button>

            {canWrite && editable ? (
              <Button asChild variant="outline">
                <Link to={`/invoices/${invoice.id}/edit`}>
                  <Pencil className="h-4 w-4" />
                  Edit
                </Link>
              </Button>
            ) : null}

            {invoice.job_id ? (
              <Button asChild variant="outline">
                <Link to={`/jobs/${invoice.job_id}`}>
                  <ClipboardList className="h-4 w-4" />
                  View report
                </Link>
              </Button>
            ) : null}

            {isAdmin && cancellable ? (
              <Button variant="destructive" disabled={transitioning} onClick={() => setCancelOpen(true)}>
                <XCircle className="h-4 w-4" />
                Cancel invoice
              </Button>
            ) : null}
          </>
        }
      />

      {/* Section 1 - Invoice info ---------------------------------------- */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Customer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <DetailField icon={UserIcon} label="Name" value={invoice.customer_name ?? '--'} />
            <DetailField icon={Mail} label="Email" value={invoice.customer_email ?? '--'} />
            <DetailField icon={Phone} label="Phone" value={invoice.customer_phone ?? '--'} />
            <DetailField icon={MapPin} label="Address" value={invoice.customer_address ?? '--'} />
            <Button asChild variant="outline" size="sm" className="w-full">
              <Link to={`/customers/${invoice.customer_id}`}>View customer</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invoice details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <DetailField icon={FileText} label="Invoice number" value={invoice.invoice_number} />
            <DetailField icon={CalendarDays} label="Issue date" value={formatDate(invoice.issue_date)} />
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Due date
                </p>
                <p
                  className={cn(
                    'break-words text-sm font-medium',
                    overdue
                      ? 'text-destructive'
                      : 'text-foreground',
                  )}
                >
                  {formatDate(invoice.due_date)}
                </p>
              </div>
            </div>
            {invoice.job_number ? (
              <DetailField
                icon={ClipboardList}
                label="Report"
                value={invoice.job_number}
                to={`/jobs/${invoice.job_id}`}
              />
            ) : null}
            {invoice.quote_number ? (
              <DetailField
                icon={Building2}
                label="Quote"
                value={invoice.quote_number}
                to={`/quotes/${invoice.quote_id}`}
              />
            ) : null}
            {invoice.sent_at ? (
              <DetailField icon={Send} label="Sent" value={formatDateTime(invoice.sent_at)} />
            ) : null}
          </CardContent>
        </Card>

        {/* Mini receipt */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Amount summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-dashed border-input bg-muted/50 p-4">
              <dl className="space-y-2 text-sm">
                {showVat ? (
                  <>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Subtotal</dt>
                      <dd className="font-medium text-foreground">
                        {formatCurrency(invoice.subtotal)}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">VAT</dt>
                      <dd className="font-medium text-foreground">
                        {formatCurrency(invoice.tax_amount)}
                      </dd>
                    </div>
                    <Separator />
                  </>
                ) : null}
                <div className="flex justify-between text-base">
                  <dt className="font-semibold text-foreground">Total</dt>
                  <dd className="font-semibold text-foreground">
                    {formatCurrency(invoice.total)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Amount paid</dt>
                  <dd className="font-medium text-primary">
                    {formatCurrency(invoice.amount_paid)}
                  </dd>
                </div>
                <Separator />
                <div className="flex justify-between text-base">
                  <dt className="font-semibold text-foreground">Balance due</dt>
                  <dd
                    className={cn(
                      'font-semibold',
                      balanceDue > 0
                        ? 'text-destructive'
                        : 'text-primary',
                    )}
                  >
                    {formatCurrency(balanceDue)}
                  </dd>
                </div>
              </dl>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Section 2 - Line items ------------------------------------------ */}
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Line items</CardTitle>
          <CardDescription>Everything being billed on this invoice.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                {showVat ? <TableHead className="text-right">VAT</TableHead> : null}
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(invoice.items ?? []).map((item, index) => (
                <TableRow key={`${item.description}-${index}`}>
                  <TableCell className="text-foreground">
                    {item.description}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {Number(item.quantity)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatCurrency(item.unit_price)}
                  </TableCell>
                  {showVat ? (
                    <TableCell className="text-right text-muted-foreground">
                      {formatCurrency(item.tax_amount)}
                    </TableCell>
                  ) : null}
                  <TableCell className="text-right font-medium text-foreground">
                    {formatCurrency(item.total)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              {showVat ? (
                <>
                  <TableRow>
                    <TableCell colSpan={4} className="text-right text-muted-foreground">
                      Subtotal
                    </TableCell>
                    <TableCell className="text-right text-foreground">
                      {formatCurrency(invoice.subtotal)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell colSpan={4} className="text-right text-muted-foreground">
                      VAT ({Math.round(Number(invoice.items?.[0]?.tax_rate ?? 0) * 100)}%)
                    </TableCell>
                    <TableCell className="text-right text-foreground">
                      {formatCurrency(invoice.tax_amount)}
                    </TableCell>
                  </TableRow>
                </>
              ) : null}
              <TableRow>
                <TableCell
                  colSpan={showVat ? 4 : 3}
                  className="text-right text-base font-semibold text-foreground"
                >
                  Total
                </TableCell>
                <TableCell className="text-right text-base font-semibold text-foreground">
                  {formatCurrency(invoice.total)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>

      {/* Section 3 - Payments -------------------------------------------- */}
      {payments.length > 0 ? (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Payments received</CardTitle>
            <CardDescription>
              {payments.length} payment{payments.length === 1 ? '' : 's'} recorded against this
              invoice.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="hidden md:table-cell">Notes</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((payment) => (
                  <TableRow key={payment.payment_id}>
                    <TableCell className="text-foreground">
                      {formatDate(payment.paid_at)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {PAYMENT_METHODS[payment.method] ?? payment.method}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {payment.reference ?? '--'}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {payment.notes ?? '--'}
                    </TableCell>
                    <TableCell className="text-right font-medium text-primary">
                      {formatCurrency(payment.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4} className="text-right text-muted-foreground">
                    Amount paid
                  </TableCell>
                  <TableCell className="text-right font-semibold text-primary">
                    {formatCurrency(invoice.amount_paid)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={4} className="text-right text-muted-foreground">
                    Balance due
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-right font-semibold',
                      balanceDue > 0
                        ? 'text-destructive'
                        : 'text-primary',
                    )}
                  >
                    {formatCurrency(balanceDue)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {/* Section 4 - Notes & terms --------------------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <button
            type="button"
            onClick={() => setNotesOpen((open) => !open)}
            className="flex w-full items-center justify-between text-left"
            aria-expanded={notesOpen}
          >
            <div>
              <CardTitle>Notes &amp; terms</CardTitle>
              <CardDescription>
                Payment terms, bank details and anything noted on this invoice.
              </CardDescription>
            </div>
            {notesOpen ? (
              <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground/70" />
            ) : (
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/70" />
            )}
          </button>
        </CardHeader>
        {notesOpen ? (
          <CardContent className="space-y-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Notes
              </p>
              <p className="mt-1 whitespace-pre-line text-sm text-foreground">
                {invoice.notes || 'No notes recorded.'}
              </p>
            </div>

            <Separator />

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Terms &amp; conditions
              </p>
              <p className="mt-1 whitespace-pre-line text-sm text-foreground">
                {invoice.terms}
              </p>
            </div>

            {invoice.payment_instructions ? (
              <>
                <Separator />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Extra payment instructions
                  </p>
                  <p className="mt-1 whitespace-pre-line text-sm text-foreground">
                    {invoice.payment_instructions}
                  </p>
                </div>
              </>
            ) : null}
          </CardContent>
        ) : null}
      </Card>

      <PaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        invoice={invoice}
        onSubmit={submitPayment}
      />

      <AlertDialog
        open={cancelOpen}
        onOpenChange={(open) => {
          if (!transitioning) setCancelOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              {invoice.invoice_number} will be marked as cancelled. It drops out of your outstanding
              balance and cannot be reopened.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={transitioning}>Keep invoice</AlertDialogCancel>
            <AlertDialogAction
              disabled={transitioning}
              className="bg-destructive hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault()
                void changeStatus(
                  INVOICE_STATUS.CANCELLED,
                  `${invoice.invoice_number} was cancelled.`,
                )
              }}
            >
              {transitioning ? 'Cancelling...' : 'Cancel invoice'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default InvoiceDetailPage
