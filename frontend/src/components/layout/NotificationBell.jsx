import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { formatDistanceToNow, isThisWeek } from 'date-fns'
import { Bell, CheckCheck } from 'lucide-react'

import { NotificationIcon } from '@/components/notifications/NotificationIcon'
import { Spinner } from '@/components/ui/spinner'
import { useNotifications } from '@/hooks/useNotifications'
import { cn, toDate } from '@/lib/utils'

/** "2 hours ago", or the plain date once it is more than a week old. */
function timeAgo(value) {
  const date = toDate(value)
  if (!date) return ''
  if (isThisWeek(date, { weekStartsOn: 1 })) {
    return `${formatDistanceToNow(date)} ago`
  }
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

/** The header bell: unread badge, dropdown panel, click-outside to close. */
export function NotificationBell() {
  const navigate = useNavigate()
  const containerRef = useRef(null)
  const [open, setOpen] = useState(false)

  const { notifications, unreadCount, isLoading, markRead, markAllRead, refresh } =
    useNotifications()

  useEffect(() => {
    if (!open) return undefined

    function handlePointerDown(event) {
      if (!containerRef.current?.contains(event.target)) setOpen(false)
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  function toggle() {
    const next = !open
    setOpen(next)
    // Opening the panel is the natural moment to pull anything new.
    if (next) void refresh()
  }

  function openNotification(notification) {
    if (!notification.is_read) void markRead(notification.id)
    setOpen(false)
    if (notification.link) navigate(notification.link)
  }

  const badge = unreadCount > 99 ? '99+' : String(unreadCount)

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={
          unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
        }
        aria-expanded={open}
        className="relative rounded-md p-2 text-slate-600 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white">
            {badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Notifications
            </span>
            <button
              type="button"
              disabled={unreadCount === 0}
              onClick={() => void markAllRead().catch(() => {})}
              className="flex items-center gap-1 text-xs font-medium text-emerald-700 disabled:cursor-not-allowed disabled:text-slate-400 dark:text-emerald-400 dark:disabled:text-slate-600"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </button>
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center gap-3 py-10 text-sm text-slate-500 dark:text-slate-400">
                <Spinner size="sm" />
                Loading...
              </div>
            ) : notifications.length === 0 ? (
              <p className="px-3 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                No notifications
              </p>
            ) : (
              notifications.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openNotification(item)}
                  className={cn(
                    'flex w-full items-start gap-3 border-b border-slate-100 px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/70',
                    item.is_read ? '' : 'bg-blue-50 dark:bg-blue-950/30',
                  )}
                >
                  <NotificationIcon notification={item} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block truncate text-sm text-slate-900 dark:text-slate-100',
                        item.is_read ? 'font-normal' : 'font-semibold',
                      )}
                    >
                      {item.title}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-sm text-slate-600 dark:text-slate-400">
                      {item.message}
                    </span>
                    <span className="mt-1 block text-xs text-slate-400">
                      {timeAgo(item.created_at)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>

          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-slate-200 px-3 py-2.5 text-center text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-50 dark:border-slate-800 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
          >
            View all
          </Link>
        </div>
      ) : null}
    </div>
  )
}

export default NotificationBell
