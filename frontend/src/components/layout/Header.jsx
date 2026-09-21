import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LogOut, Monitor, Moon, Search, Sun, X } from 'lucide-react'

import { logout as logoutRequest } from '@/api/auth'
import { HeaderSearch } from '@/components/layout/HeaderSearch'
import { LogoMark } from '@/components/layout/Logo'
import { NotificationBell } from '@/components/layout/NotificationBell'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { ROLE_LABELS, UserRole } from '@/lib/constants'
import { ADMIN_NAV, visibleNav } from '@/lib/navigation'
import { getTheme, setTheme } from '@/lib/theme'
import { getInitials } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'

const ROLE_BADGE_VARIANT = {
  [UserRole.ADMIN]: 'default',
  [UserRole.OFFICE_STAFF]: 'info',
  [UserRole.TECHNICIAN]: 'secondary',
}

const THEME_OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Match device', icon: Monitor },
]

const iconButton =
  'inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function Header() {
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const clearAuth = useAuthStore((state) => state.logout)
  const [signingOut, setSigningOut] = useState(false)
  const [theme, setThemeState] = useState(getTheme)

  // On a phone there is no room for a permanent search field, so it expands
  // over the header instead.
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)

  // The sidebar holds the admin links on desktop; on a phone they live here.
  const adminLinks = visibleNav(ADMIN_NAV, user?.role)

  async function handleLogout() {
    setSigningOut(true)
    try {
      await logoutRequest()
    } catch {
      /* the session is cleared locally regardless of the server response */
    } finally {
      clearAuth()
      setSigningOut(false)
      navigate('/login', { replace: true })
    }
  }

  function chooseTheme(value) {
    setTheme(value)
    setThemeState(value)
  }

  return (
    <header className="relative flex h-16 shrink-0 items-center gap-1 border-b border-border bg-card px-3 sm:gap-2 sm:px-6">
      <Link
        to="/dashboard"
        aria-label="QKil home"
        className="mr-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
      >
        <LogoMark size={32} />
      </Link>

      {/* Desktop search */}
      <HeaderSearch className="hidden w-full max-w-md md:block" />

      <div className="flex-1" />

      {/* Mobile search trigger */}
      <button type="button" onClick={() => setMobileSearchOpen(true)} className={`${iconButton} md:hidden`} aria-label="Search">
        <Search className="h-5 w-5" />
      </button>

      {user ? <NotificationBell /> : null}

      {user ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex min-h-11 items-center gap-3 rounded-full py-1 pl-1 pr-1 transition-colors duration-150 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:pr-3"
              aria-label="Account menu"
            >
              <Avatar>
                <AvatarFallback>{getInitials(user.full_name)}</AvatarFallback>
              </Avatar>
              <span className="hidden text-left sm:block">
                <span className="block text-sm font-medium leading-tight text-foreground">{user.full_name}</span>
                <span className="block text-xs leading-tight text-muted-foreground">{ROLE_LABELS[user.role]}</span>
              </span>
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold">{user.full_name}</span>
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                <Badge variant={ROLE_BADGE_VARIANT[user.role]} className="w-fit">
                  {ROLE_LABELS[user.role]}
                </Badge>
              </div>
            </DropdownMenuLabel>

            {adminLinks.length > 0 ? (
              <div className="lg:hidden">
                <DropdownMenuSeparator />
                {adminLinks.map((item) => {
                  const Icon = item.icon
                  return (
                    <DropdownMenuItem key={item.to} onSelect={() => navigate(item.to)}>
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </DropdownMenuItem>
                  )
                })}
              </div>
            ) : null}

            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Appearance
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup value={theme} onValueChange={chooseTheme}>
              {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  <Icon className="h-4 w-4" />
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>

            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                void handleLogout()
              }}
              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
            >
              {signingOut ? <Spinner size="sm" className="text-current" /> : <LogOut className="h-4 w-4" />}
              {signingOut ? 'Signing out...' : 'Sign out'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {/* Mobile full-width search overlay */}
      {mobileSearchOpen ? (
        <div className="absolute inset-x-0 top-0 z-40 flex h-16 items-center gap-2 bg-card px-3 md:hidden">
          <HeaderSearch className="flex-1" autoFocus onDismiss={() => setMobileSearchOpen(false)} />
          <button type="button" onClick={() => setMobileSearchOpen(false)} className={iconButton} aria-label="Close search">
            <X className="h-5 w-5" />
          </button>
        </div>
      ) : null}
    </header>
  )
}
