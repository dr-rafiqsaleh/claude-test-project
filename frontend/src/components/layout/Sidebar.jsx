import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  CalendarClock,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Receipt,
  Settings,
  Users,
  UserCog,
  X,
} from 'lucide-react'

import { getInvoiceSummary } from '@/api/invoices'
import { Logo } from '@/components/layout/Logo'
import { useAuthStore } from '@/store/authStore'
import { cn } from '@/lib/utils'
import { UserRole, WRITE_ROLES } from '@/lib/constants'

const NAV_ITEMS = [
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
  // Workflow sequence: Customer → Quote → Booking → Job → Invoice
  { label: 'Customers', to: '/customers', icon: Users },
  { label: 'Quotes', to: '/quotes', icon: FileText },
  { label: 'Bookings', to: '/bookings', icon: CalendarClock },
  { label: 'Jobs', to: '/jobs', icon: ClipboardList },
  { label: 'Invoices', to: '/invoices', icon: Receipt, roles: WRITE_ROLES, key: 'invoices' },
  // Admin
  { label: 'Users', to: '/users', icon: UserCog, roles: [UserRole.ADMIN] },
  { label: 'Settings', to: '/settings', icon: Settings, roles: [UserRole.ADMIN] },
]

/**
 * Flags whether there is money past its due date, so the Invoices nav item can
 * carry a red dot. Deliberately local state - it is a hint, not shared data.
 */
function useOverdueInvoices(enabled) {
  const [hasOverdue, setHasOverdue] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setHasOverdue(false)
      return undefined
    }

    const controller = new AbortController()

    async function load() {
      try {
        const summary = await getInvoiceSummary(controller.signal)
        if (!controller.signal.aborted) {
          setHasOverdue((summary?.overdue_count ?? 0) > 0 || (summary?.total_overdue ?? 0) > 0)
        }
      } catch {
        // A missing summary should never break navigation.
        if (!controller.signal.aborted) setHasOverdue(false)
      }
    }

    void load()
    return () => controller.abort()
  }, [enabled])

  return hasOverdue
}

export function Sidebar({ open, onClose }) {
  const user = useAuthStore((state) => state.user)
  const canWrite = useAuthStore((state) => state.canWrite())
  const hasOverdue = useOverdueInvoices(canWrite)

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.roles || (user !== null && item.roles.includes(user.role)),
  )

  const content = (
    <div className="flex h-full flex-col bg-slate-900 text-slate-100">
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-800 px-5">
        <Logo textClassName="text-white" subtitle="Pest Control" />
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
          aria-label="Close navigation"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {visibleItems.map((item) => {
          const Icon = item.icon

          if (item.comingSoon) {
            return (
              <div
                key={item.label}
                className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-500"
                title="Coming soon"
              >
                <Icon className="shrink-0" style={{ width: 18, height: 18 }} />
                <span className="flex-1">{item.label}</span>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Soon
                </span>
              </div>
            )
          }

          const showDot = item.key === 'invoices' && hasOverdue

          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white',
                )
              }
            >
              <Icon style={{ width: 18, height: 18 }} className="shrink-0" />
              <span className="flex-1">{item.label}</span>
              {showDot ? (
                <span
                  className="h-2 w-2 shrink-0 rounded-full bg-red-500"
                  title="You have overdue invoices"
                  aria-label="Overdue invoices"
                />
              ) : null}
            </NavLink>
          )
        })}
      </nav>

      <div className="shrink-0 border-t border-slate-800 px-5 py-4">
        <p className="text-xs text-slate-500">QKil Phase 8</p>
        <p className="text-xs text-slate-600">v0.6.0</p>
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop */}
      <aside className="hidden w-64 shrink-0 lg:block">{content}</aside>

      {/* Mobile drawer */}
      <div
        className={cn(
          'fixed inset-0 z-40 lg:hidden',
          open ? 'pointer-events-auto' : 'pointer-events-none',
        )}
        aria-hidden={!open}
      >
        <div
          className={cn(
            'absolute inset-0 bg-slate-950/60 transition-opacity',
            open ? 'opacity-100' : 'opacity-0',
          )}
          onClick={onClose}
        />
        <div
          className={cn(
            'absolute inset-y-0 left-0 w-64 transition-transform duration-200 ease-out',
            open ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          {content}
        </div>
      </div>
    </>
  )
}
