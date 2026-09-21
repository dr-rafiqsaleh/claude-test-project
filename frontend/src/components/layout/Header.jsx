import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, Menu, Search, User as UserIcon, X } from 'lucide-react'

import { logout as logoutRequest } from '@/api/auth'
import { HeaderSearch } from '@/components/layout/HeaderSearch'
import { NotificationBell } from '@/components/layout/NotificationBell'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { getInitials } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { ROLE_LABELS, UserRole } from '@/lib/constants'

const ROLE_BADGE_VARIANT = {
  [UserRole.ADMIN]: 'default',
  [UserRole.OFFICE_STAFF]: 'info',
  [UserRole.TECHNICIAN]: 'secondary',
}

export function Header({ onOpenSidebar }) {
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const clearAuth = useAuthStore((state) => state.logout)
  const [signingOut, setSigningOut] = useState(false)

  // On a phone there is no room for a permanent search field, so it expands
  // over the header instead.
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)

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

  return (
    <header className="relative flex h-16 shrink-0 items-center gap-2 border-b border-border bg-card px-4 sm:gap-3 sm:px-6">
      <button
        type="button"
        onClick={onOpenSidebar}
        className="rounded-md p-2 text-muted-foreground hover:bg-muted lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Desktop search */}
      <HeaderSearch className="hidden w-full max-w-md md:block" />

      <div className="flex-1" />

      {/* Mobile search trigger */}
      <button
        type="button"
        onClick={() => setMobileSearchOpen(true)}
        className="rounded-md p-2 text-muted-foreground hover:bg-muted md:hidden"
        aria-label="Search"
      >
        <Search className="h-5 w-5" />
      </button>

      {user ? <NotificationBell /> : null}

      {user ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-3 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Avatar>
                <AvatarFallback>{getInitials(user.full_name)}</AvatarFallback>
              </Avatar>
              <span className="hidden text-left sm:block">
                <span className="block text-sm font-medium leading-tight text-foreground">
                  {user.full_name}
                </span>
                <span className="block text-xs leading-tight text-muted-foreground">
                  {ROLE_LABELS[user.role]}
                </span>
              </span>
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold">{user.full_name}</span>
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                <Badge variant={ROLE_BADGE_VARIANT[user.role]} className="w-fit">
                  {ROLE_LABELS[user.role]}
                </Badge>
              </div>
            </DropdownMenuLabel>

            <DropdownMenuSeparator />

            <DropdownMenuItem disabled>
              <UserIcon className="h-4 w-4" />
              Profile settings
              <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground/70">Soon</span>
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                void handleLogout()
              }}
              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
            >
              {signingOut ? <Spinner size="sm" className="text-destructive" /> : <LogOut className="h-4 w-4" />}
              {signingOut ? 'Signing out...' : 'Sign out'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {/* Mobile full-width search overlay */}
      {mobileSearchOpen ? (
        <div className="absolute inset-x-0 top-0 z-40 flex h-16 items-center gap-2 bg-card px-4 md:hidden">
          <HeaderSearch
            className="flex-1"
            autoFocus
            onDismiss={() => setMobileSearchOpen(false)}
          />
          <button
            type="button"
            onClick={() => setMobileSearchOpen(false)}
            className="rounded-md p-2 text-muted-foreground hover:bg-muted"
            aria-label="Close search"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      ) : null}
    </header>
  )
}
