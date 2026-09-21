import { Bell, Calendar, ClipboardList, FileText, Receipt } from 'lucide-react'

import { cn } from '@/lib/utils'
import { NOTIFICATION_ACCENT, NOTIFICATION_CATEGORY } from '@/lib/constants'

/** One icon per notification category. */
const ICONS = {
  bookings: Calendar,
  invoices: Receipt,
  jobs: ClipboardList,
  quotes: FileText,
  system: Bell,
}

/** Resolve a notification to its category, tolerating an unknown type. */
export function notificationCategory(notification) {
  return (
    notification?.category ||
    NOTIFICATION_CATEGORY[notification?.type] ||
    'system'
  )
}

/** The notification's icon inside a rounded, colour-coded chip. */
export function NotificationIcon({ notification, className, size = 'md' }) {
  const category = notificationCategory(notification)
  const Icon = ICONS[category] ?? Bell
  const box = size === 'sm' ? 'h-8 w-8' : 'h-9 w-9'

  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full',
        box,
        NOTIFICATION_ACCENT[category] ?? NOTIFICATION_ACCENT.system,
        className,
      )}
      aria-hidden="true"
    >
      <Icon className="h-4 w-4" />
    </span>
  )
}

export default NotificationIcon
