import { cn } from '@/lib/utils'
import { BOOKING_STATUS_COLORS, BOOKING_STATUS_LABELS } from '@/lib/constants'

/** Dark-mode companion classes for each booking status. */
const DARK_CLASSES = {
  scheduled: 'dark:bg-indigo-900/40 dark:text-indigo-300',
  confirmed: 'dark:bg-sky-900/40 dark:text-sky-300',
  in_progress: 'dark:bg-amber-900/40 dark:text-amber-300',
  completed: '',
  cancelled: '',
}

/** Pill showing a booking's lifecycle status. */
export function BookingStatusBadge({ status, className }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-transparent px-2.5 py-0.5 text-xs font-medium',
        BOOKING_STATUS_COLORS[status] ?? 'bg-muted text-foreground',
        DARK_CLASSES[status] ?? '',
        className,
      )}
    >
      {BOOKING_STATUS_LABELS[status] ?? status}
    </span>
  )
}

export default BookingStatusBadge
