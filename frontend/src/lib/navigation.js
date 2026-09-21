import { CalendarDays, FileText, Home, Receipt, Settings, UserCog, Users } from 'lucide-react'

import { UserRole, WRITE_ROLES } from '@/lib/constants'

/**
 * The app's navigation, shared by the desktop sidebar and the phone tab bar.
 * Daily work comes first, in the order the work flows; at most five items so
 * it fits a phone's bottom bar.
 *
 * `match` lists the route prefixes an item owns: a visit's report lives under
 * /jobs, but it is part of the schedule.
 */
export const PRIMARY_NAV = [
  { label: 'Today', to: '/dashboard', icon: Home },
  { label: 'Schedule', to: '/bookings', icon: CalendarDays, match: ['/bookings', '/jobs'] },
  { label: 'Customers', to: '/customers', icon: Users },
  { label: 'Quotes', to: '/quotes', icon: FileText, roles: WRITE_ROLES },
  { label: 'Invoices', to: '/invoices', icon: Receipt, roles: WRITE_ROLES, key: 'invoices' },
]

/** Running the business rather than doing the work: kept apart, admins only. */
export const ADMIN_NAV = [
  { label: 'Team', to: '/users', icon: UserCog, roles: [UserRole.ADMIN] },
  { label: 'Settings', to: '/settings', icon: Settings, roles: [UserRole.ADMIN] },
]

export function visibleNav(items, role) {
  return items.filter((item) => !item.roles || (role && item.roles.includes(role)))
}

export function isNavActive(item, pathname) {
  return (item.match ?? [item.to]).some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}
