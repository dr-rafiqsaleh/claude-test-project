import { Suspense } from 'react'
import { Outlet, useMatch, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

import { Header } from '@/components/layout/Header'
import { Logo } from '@/components/layout/Logo'
import { MobileNav, Sidebar, useOverdueInvoices } from '@/components/layout/Navigation'
import { WorkingClientBar } from '@/components/layout/WorkingClientBar'
import { Button } from '@/components/ui/button'
import { LoadingState } from '@/components/ui/spinner'
import { useAuthStore } from '@/store/authStore'

/**
 * The technician field form is a full-screen, single-column flow - no
 * navigation, just a back button - so it works one-handed on a phone.
 */
function FieldShell() {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-2">
        <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Back" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <Logo size={28} subtitle="Field report" />
      </header>

      <main className="flex-1">
        <Suspense fallback={<LoadingState />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}

/** Application chrome: sidebar (desktop) or tab bar (phone), header, routed page. */
export function AppShell() {
  const isFieldForm = useMatch('/jobs/:id/report')
  const canWrite = useAuthStore((state) => state.canWrite())
  const hasOverdue = useOverdueInvoices(canWrite && !isFieldForm)

  if (isFieldForm) {
    return <FieldShell />
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <Sidebar hasOverdue={hasOverdue} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <WorkingClientBar />
        <main className="flex-1 overflow-y-auto">
          {/* Bottom padding clears the phone tab bar. */}
          <div className="mx-auto w-full max-w-7xl px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">
            <Suspense fallback={<LoadingState />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>

      <MobileNav hasOverdue={hasOverdue} />
    </div>
  )
}

export default AppShell
