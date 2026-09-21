import { useState } from 'react'
import { Outlet, useMatch, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

import { Header } from '@/components/layout/Header'
import { Logo } from '@/components/layout/Logo'
import { Sidebar } from '@/components/layout/Sidebar'
import { Button } from '@/components/ui/button'

/**
 * The technician field form is a full-screen, single-column flow - no sidebar,
 * just a back button - so it works one-handed on a phone.
 */
function FieldShell() {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 dark:bg-slate-950">
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 dark:border-slate-800 dark:bg-slate-900">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          aria-label="Back"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <Logo subtitle="Field report" />
      </header>

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}

/** Application chrome: sidebar + header + routed content. */
export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const isFieldForm = useMatch('/jobs/:id/report')

  if (isFieldForm) {
    return <FieldShell />
  }

  return (
    <div className="flex h-full min-h-screen bg-slate-50 dark:bg-slate-950">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default AppShell
