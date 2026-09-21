import { Calendar, ClipboardList, FileText, Receipt, Search, Users } from 'lucide-react'

import { cn } from '@/lib/utils'

/** One icon per searchable collection, keyed by both group and item type. */
const ICONS = {
  customers: Users,
  customer: Users,
  quotes: FileText,
  quote: FileText,
  bookings: Calendar,
  booking: Calendar,
  jobs: ClipboardList,
  job: ClipboardList,
  invoices: Receipt,
  invoice: Receipt,
}

/** Chip colour per collection, so results are scannable at a glance. */
const CHIP = {
  customers: 'bg-muted text-muted-foreground',
  quotes: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  bookings: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  jobs: 'bg-primary/15 text-primary',
  invoices: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
}

const GROUP_FOR = {
  customer: 'customers',
  quote: 'quotes',
  booking: 'bookings',
  job: 'jobs',
  invoice: 'invoices',
}

/** The bare lucide icon for a search result type. */
export function SearchResultIcon({ type, className }) {
  const Icon = ICONS[type] ?? Search
  return <Icon className={cn('h-4 w-4', className)} />
}

/** The icon inside a rounded, colour-coded chip. */
export function SearchResultIconChip({ type, className, size = 'md' }) {
  const group = GROUP_FOR[type] ?? type
  const box = size === 'sm' ? 'h-8 w-8' : 'h-9 w-9'

  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md',
        box,
        CHIP[group] ?? CHIP.customers,
        className,
      )}
      aria-hidden="true"
    >
      <SearchResultIcon type={type} />
    </span>
  )
}

export default SearchResultIcon
