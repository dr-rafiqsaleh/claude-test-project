import { cn } from '@/lib/utils'
import { INVOICE_STATUS_COLORS, INVOICE_STATUS_LABELS } from '@/lib/constants'

/** Dark-mode companion classes for each invoice status. */
const DARK_CLASSES = {
  draft: '',
  sent: 'dark:bg-blue-900/40 dark:text-blue-300',
  paid: '',
  partially_paid: 'dark:bg-teal-900/40 dark:text-teal-300',
  overdue: '',
  cancelled: '',
}

/** Pill showing an invoice's lifecycle status. */
export function InvoiceStatusBadge({ status, className }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-transparent px-2.5 py-0.5 text-xs font-medium',
        INVOICE_STATUS_COLORS[status] ?? 'bg-muted text-foreground',
        DARK_CLASSES[status] ?? '',
        className,
      )}
    >
      {INVOICE_STATUS_LABELS[status] ?? status}
    </span>
  )
}

export default InvoiceStatusBadge
