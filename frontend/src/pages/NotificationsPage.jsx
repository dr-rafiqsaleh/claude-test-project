import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow, isThisWeek, isToday, isYesterday } from 'date-fns'
import { AlertCircle, BellOff, CheckCheck, Trash2 } from 'lucide-react'

import { NotificationIcon, notificationCategory } from '@/components/notifications/NotificationIcon'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { LoadingState } from '@/components/ui/spinner'
import { toastError, toastSuccess } from '@/components/ui/use-toast'
import { useNotifications } from '@/hooks/useNotifications'
import { toApiError } from '@/lib/api'
import { cn, toDate } from '@/lib/utils'
import { NOTIFICATION_FILTERS } from '@/lib/constants'

/** Date buckets, newest first. */
const GROUPS = ['Today', 'Yesterday', 'This Week', 'Older']

function groupFor(value) {
  const date = toDate(value)
  if (!date) return 'Older'
  if (isToday(date)) return 'Today'
  if (isYesterday(date)) return 'Yesterday'
  if (isThisWeek(date, { weekStartsOn: 1 })) return 'This Week'
  return 'Older'
}

/** "2 hours ago", or the plain date once it is more than a week old. */
function timeAgo(value) {
  const date = toDate(value)
  if (!date) return ''
  if (isThisWeek(date, { weekStartsOn: 1 })) {
    return `${formatDistanceToNow(date)} ago`
  }
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

const EMPTY_COPY = {
  all: 'You have no notifications yet. Reminders about bookings, invoices and follow-ups will land here.',
  unread: 'Nothing unread. You are all caught up.',
  bookings: 'No booking reminders right now.',
  invoices: 'No invoice alerts right now.',
  jobs: 'No job notifications right now.',
  quotes: 'No quote notifications right now.',
}

export function NotificationsPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState(false)

  const {
    notifications,
    unreadCount,
    isLoading,
    error,
    markRead,
    markAllRead,
    deleteNotification,
    refresh,
  } = useNotifications()

  const visible = useMemo(() => {
    if (filter === 'all') return notifications
    if (filter === 'unread') return notifications.filter((item) => !item.is_read)
    return notifications.filter((item) => notificationCategory(item) === filter)
  }, [notifications, filter])

  const grouped = useMemo(() => {
    const buckets = new Map(GROUPS.map((name) => [name, []]))
    for (const item of visible) {
      buckets.get(groupFor(item.created_at)).push(item)
    }
    return GROUPS.map((name) => [name, buckets.get(name)]).filter(([, items]) => items.length > 0)
  }, [visible])

  async function open(notification) {
    if (!notification.is_read) void markRead(notification.id)
    if (notification.link) navigate(notification.link)
  }

  async function handleMarkAllRead() {
    setBusy(true)
    try {
      await markAllRead()
      toastSuccess('All caught up', 'Every notification is now marked as read.')
    } catch (err) {
      toastError('Could not mark them read', toApiError(err).message)
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(notification) {
    try {
      await deleteNotification(notification.id)
    } catch (err) {
      toastError('Could not delete this notification', toApiError(err).message)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Notifications
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {unreadCount > 0
              ? `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}.`
              : 'Reminders about bookings, invoices, jobs and quotes.'}
          </p>
        </div>

        <Button
          variant="outline"
          disabled={busy || unreadCount === 0}
          onClick={() => void handleMarkAllRead()}
        >
          <CheckCheck className="h-4 w-4" />
          Mark all read
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {NOTIFICATION_FILTERS.map((tab) => {
          const isActive = filter === tab.key
          const count =
            tab.key === 'all'
              ? notifications.length
              : tab.key === 'unread'
                ? unreadCount
                : notifications.filter((item) => notificationCategory(item) === tab.key).length

          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilter(tab.key)}
              aria-pressed={isActive}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                isActive
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-transparent dark:text-slate-300 dark:hover:bg-slate-800',
              )}
            >
              {tab.label}
              {count > 0 ? (
                <span className={cn('ml-1.5', isActive ? 'text-emerald-100' : 'text-slate-400')}>
                  {count}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      {isLoading ? (
        <Card>
          <LoadingState message="Loading notifications..." />
        </Card>
      ) : error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <AlertCircle className="h-10 w-10 text-red-500" />
            <div>
              <p className="font-medium text-slate-900 dark:text-slate-100">
                Could not load notifications
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{error.message}</p>
            </div>
            <Button variant="outline" onClick={() => void refresh()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
              <BellOff className="h-7 w-7 text-slate-400" />
            </div>
            <div>
              <p className="font-medium text-slate-900 dark:text-slate-100">No notifications</p>
              <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">
                {EMPTY_COPY[filter] ?? EMPTY_COPY.all}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {grouped.map(([label, items]) => (
            <section key={label} className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {label}
              </h2>

              <div className="space-y-2">
                {items.map((item) => (
                  <Card
                    key={item.id}
                    className={cn(
                      'transition-colors',
                      item.is_read ? '' : 'border-blue-200 bg-blue-50/60 dark:border-blue-900 dark:bg-blue-950/30',
                    )}
                  >
                    <div className="flex items-start gap-3 p-4">
                      <NotificationIcon notification={item} />

                      <button
                        type="button"
                        onClick={() => void open(item)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p
                          className={cn(
                            'text-sm text-slate-900 dark:text-slate-100',
                            item.is_read ? 'font-normal' : 'font-semibold',
                          )}
                        >
                          {item.title}
                        </p>
                        <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
                          {item.message}
                        </p>
                        <p className="mt-1.5 text-xs text-slate-400">{timeAgo(item.created_at)}</p>
                      </button>

                      <div className="flex shrink-0 items-center gap-1">
                        {item.is_read ? null : (
                          <span
                            className="h-2 w-2 rounded-full bg-blue-500"
                            aria-label="Unread"
                            title="Unread"
                          />
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-slate-400 hover:text-red-600"
                          aria-label="Delete notification"
                          onClick={() => void handleDelete(item)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

export default NotificationsPage
