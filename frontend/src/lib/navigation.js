import { Building2, ClipboardList, FileText, History, Home, Receipt, Settings, Settings2, UserCog, Users } from 'lucide-react'

/**
 * The app's navigation, shared by the desktop sidebar and the phone tab bar.
 * Daily work comes first, in the order the work flows; at most five items so
 * it fits a phone's bottom bar.
 *
 * `match` lists the route prefixes an item owns: a job's report lives under
 * /jobs, so it belongs to Jobs too.
 */
export const PRIMARY_NAV = [
  { label: 'Today', to: '/dashboard', icon: Home },
  { label: 'Jobs', to: '/bookings', icon: ClipboardList, match: ['/bookings', '/jobs'] },
  { label: 'Customers', to: '/customers', icon: Users },
  { label: 'Quotes', to: '/quotes', icon: FileText, permission: 'quotes.view' },
  { label: 'Invoices', to: '/invoices', icon: Receipt, permission: 'invoices.view', key: 'invoices' },
]

/** Running the business rather than doing the work: kept apart. */
export const ADMIN_NAV = [
  { label: 'Team', to: '/users', icon: UserCog, permission: 'users.manage' },
  { label: 'Audit', to: '/audit', icon: History, permission: 'audit.view' },
  { label: 'Settings', to: '/settings', icon: Settings, permission: 'settings.manage' },
]

/** Running PestBase itself rather than any one client: platform staff only. */
export const PLATFORM_NAV = [
  { label: 'Clients', to: '/platform/clients', icon: Building2, platform: true },
  { label: 'Platform settings', to: '/platform/settings', icon: Settings2, platform: true },
]

/**
 * Keeps only the items this person may open: a permission comes from their
 * role, `platform` from being PestBase staff. Platform access is deliberately not
 * a permission - a client's own Admin role holds every permission there is.
 */
export function visibleNav(items, user) {
  return items.filter((item) => {
    if (item.platform) return Boolean(user?.is_platform_staff)
    return !item.permission || Boolean(user?.permissions?.includes(item.permission))
  })
}

export function isNavActive(item, pathname) {
  return (item.match ?? [item.to]).some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}
