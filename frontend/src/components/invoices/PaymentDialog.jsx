import { useEffect, useState } from 'react'
import { AlertCircle, Banknote } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { FormField, SELECT_CLASSES } from '@/components/jobs/JobFormControls'
import { formatCurrency, fromDateTimeInputValue, toDateTimeInputValue } from '@/lib/utils'
import { PAYMENT_METHODS } from '@/lib/constants'

const METHOD_ENTRIES = Object.entries(PAYMENT_METHODS)

function blankPayment(invoice) {
  return {
    amount: invoice ? String(Number(invoice.amount_due ?? 0).toFixed(2)) : '',
    method: 'bank_transfer',
    reference: '',
    notes: '',
    paid_at: toDateTimeInputValue(new Date()),
  }
}

/**
 * Modal for recording money received against an invoice.
 *
 * `onSubmit` receives the API payload and should return a promise; the dialog
 * stays open (showing the error) if it rejects.
 */
export function PaymentDialog({ open, onOpenChange, invoice, onSubmit }) {
  const [values, setValues] = useState(() => blankPayment(invoice))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  // Re-seed the form each time the dialog opens, so the amount matches the
  // balance still owing right now.
  useEffect(() => {
    if (open) {
      setValues(blankPayment(invoice))
      setError(null)
    }
  }, [open, invoice])

  if (!invoice) return null

  const amountDue = Number(invoice.amount_due ?? 0)
  const amount = Number(values.amount)
  const amountValid = Number.isFinite(amount) && amount > 0 && amount <= amountDue + 0.005

  function setField(field, value) {
    setValues((current) => ({ ...current, [field]: value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!amountValid) {
      setError(
        amount > amountDue
          ? `The payment cannot exceed the balance due of ${formatCurrency(amountDue)}.`
          : 'Enter a payment amount greater than zero.',
      )
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      await onSubmit({
        amount: Math.round(amount * 100) / 100,
        method: values.method,
        reference: values.reference.trim() || null,
        notes: values.notes.trim() || null,
        paid_at: fromDateTimeInputValue(values.paid_at) ?? new Date().toISOString(),
      })
      onOpenChange(false)
    } catch (err) {
      setError(err?.message ?? 'Could not record this payment.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting) onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
          <DialogDescription>
            {invoice.invoice_number} &middot; balance due{' '}
            <span className="font-medium text-foreground">
              {formatCurrency(amountDue)}
            </span>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {error ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <FormField label="Amount (GBP)" htmlFor="payment-amount">
            <Input
              id="payment-amount"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={values.amount}
              hasError={Boolean(values.amount) && !amountValid}
              onChange={(event) => setField('amount', event.target.value)}
              autoFocus
            />
          </FormField>

          <FormField label="Payment method" htmlFor="payment-method">
            <select
              id="payment-method"
              value={values.method}
              onChange={(event) => setField('method', event.target.value)}
              className={SELECT_CLASSES}
            >
              {METHOD_ENTRIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Reference" htmlFor="payment-reference" hint="Optional">
            <Input
              id="payment-reference"
              value={values.reference}
              placeholder="EFT-88213 / receipt number"
              onChange={(event) => setField('reference', event.target.value)}
            />
          </FormField>

          <FormField label="Notes" htmlFor="payment-notes" hint="Optional">
            <Textarea
              id="payment-notes"
              rows={2}
              value={values.notes}
              placeholder="Part payment agreed over the phone."
              onChange={(event) => setField('notes', event.target.value)}
            />
          </FormField>

          <FormField label="Date received" htmlFor="payment-date">
            <Input
              id="payment-date"
              type="datetime-local"
              value={values.paid_at}
              onChange={(event) => setField('paid_at', event.target.value)}
            />
          </FormField>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !amountValid}>
              {submitting ? (
                <Spinner size="sm" className="text-current" />
              ) : (
                <Banknote className="h-4 w-4" />
              )}
              {submitting ? 'Recording...' : 'Record payment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default PaymentDialog
