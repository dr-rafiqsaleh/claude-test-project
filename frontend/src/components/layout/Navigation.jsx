import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { getInvoiceSummary } from '@/api/invoices'
import { Logo } from '@/components/layout/Logo'
import { cn } from '@/lib/utils'
import { ADMIN_NAV, PLATFORM_NAV, PRIMARY_NAV, isNavActive, visibleNav } from '@/lib/navigation'
import { useAuthStore } from '@/store/authStore'

/**
 * Whether money is past its due date, so Invoices can carry a red dot. A hint,
 * not shared data - fetched once by the shell and handed to both navs.
 */
export function useOverdueInvoices(enabled, scope) {
  const [hasOverdue, setHasOverdue] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setHasOverdue(false)
      return undefined
    }
    const controller = new AbortController()
    getInvoiceSummary(controller.signal)
      .then((summary) => {
        if (!controller.signal.aborted) {
          setHasOverdue((summary?.overdue_count ?? 0) > 0 || (summary?.total_overdue ?? 0) > 0)
        }
      })
      .catch(() => {
        // A missing summary must never break navigation.
      })
    return () => controller.abort()
    // `scope`: the client in view, so switching client asks again.
  }, [enabled, scope])

  return hasOverdue
}

function OverdueDot({ className }) {
  return (
    <span
      className={cn('h-2 w-2 shrink-0 rounded-full bg-destructive', className)}
      title="You have overdue invoices"
      aria-label="Overdue invoices"
    />
  )
}

function SidebarLink({ item, active, showDot }) {
  const Icon = item.icon
  return (
    <Link
      to={item.to}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150',
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <Icon className={cn('h-[18px] w-[18px] shrink-0', active && 'text-primary')} aria-hidden="true" />
      <span className="flex-1">{item.label}</span>
      {showDot ? <OverdueDot /> : null}
    </Link>
  )
}

/** Desktop navigation: a quiet, light rail; the page stays the focus. */
export function Sidebar({ hasOverdue }) {
  const { pathname } = useLocation()
  const user = useAuthStore((state) => state.user)
  const primary = visibleNav(PRIMARY_NAV, user)
  const admin = visibleNav(ADMIN_NAV, user)
  const platform = visibleNav(PLATFORM_NAV, user)

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card lg:flex">
      <div className="flex h-16 shrink-0 items-center px-5">
        <Link to="/dashboard" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Logo subtitle="Pest Control" />
        </Link>
      </div>

      <nav aria-label="Main" className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        <div className="space-y-1">
          {primary.map((item) => (
            <SidebarLink
              key={item.to}
              item={item}
              active={isNavActive(item, pathname)}
              showDot={item.key === 'invoices' && hasOverdue}
            />
          ))}
        </div>

        {admin.length > 0 ? (
          <div className="space-y-1">
            <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Admin
            </p>
            {admin.map((item) => (
              <SidebarLink key={item.to} item={item} active={isNavActive(item, pathname)} />
            ))}
          </div>
        ) : null}

        {/* Running PestBase itself, kept apart from running one company. */}
        {platform.length > 0 ? (
          <div className="space-y-1">
            <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Platform
            </p>
            {platform.map((item) => (
              <SidebarLink key={item.to} item={item} active={isNavActive(item, pathname)} />
            ))}
          </div>
        ) : null}
      </nav>
    </aside>
  )
}

/**
 * Phone navigation: a bottom tab bar within thumb reach, with 64px-tall
 * targets - usable on site with one hand, or with gloves on.
 */
export function MobileNav({ hasOverdue }) {
  const { pathname } = useLocation()
  const user = useAuthStore((state) => state.user)
  const items = visibleNav(PRIMARY_NAV, user)

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex max-w-lg">
        {items.map((item) => {
          const Icon = item.icon
          const active = isNavActive(item, pathname)
          return (
            <li key={item.to} className="flex-1">
              <Link
                to={item.to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors duration-150',
                  active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                {item.label}
                {item.key === 'invoices' && hasOverdue ? (
                  <OverdueDot className="absolute right-[calc(50%-16px)] top-2.5" />
                ) : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
