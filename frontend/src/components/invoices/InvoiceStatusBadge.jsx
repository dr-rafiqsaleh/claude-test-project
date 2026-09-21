import { cn } from '@/lib/utils'
import { INVOICE_STATUS_COLORS, INVOICE_STATUS_LABELS } from '@/lib/constants'

/** Dark-mode companion classes for each invoice status. */
const DARK_CLASSES = {
  draft: 'dark:bg-slate-800 dark:text-slate-300',
  sent: 'dark:bg-blue-900/40 dark:text-blue-300',
  paid: 'dark:bg-emerald-900/40 dark:text-emerald-300',
  partially_paid: 'dark:bg-teal-900/40 dark:text-teal-300',
  overdue: 'dark:bg-red-900/40 dark:text-red-300',
  cancelled: 'dark:bg-slate-800 dark:text-slate-500',
}

/** Pill showing an invoice's lifecycle status. */
export function InvoiceStatusBadge({ status, className }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-transparent px-2.5 py-0.5 text-xs font-medium',
        INVOICE_STATUS_COLORS[status] ?? 'bg-slate-100 text-slate-700',
        DARK_CLASSES[status] ?? 'dark:bg-slate-800 dark:text-slate-300',
        className,
      )}
    >
      {INVOICE_STATUS_LABELS[status] ?? status}
    </span>
  )
}

export default InvoiceStatusBadge
