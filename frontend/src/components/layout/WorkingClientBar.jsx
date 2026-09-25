import { Building2, LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/store/authStore'

/**
 * Says, unmissably, that you are inside somebody else's account.
 *
 * PestBase staff working in a client see that client's customers, jobs and invoices
 * as if they were its own team, and every change they make lands on that
 * client's audit trail where the client will read it. That is not a state to
 * leave someone in without telling them, so this sits above everything, in a
 * colour the rest of the app does not use, until they step back out.
 */
export function WorkingClientBar() {
  const navigate = useNavigate()
  const workingClient = useAuthStore((state) => state.workingClient)
  const setWorkingClient = useAuthStore((state) => state.setWorkingClient)
  const isPlatformStaff = useAuthStore((state) => Boolean(state.user?.is_platform_staff))

  if (!isPlatformStaff || !workingClient) return null

  function leave() {
    setWorkingClient(null)
    navigate('/platform/clients', { replace: true })
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200 sm:px-6"
    >
      <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        You are working inside{' '}
        <span className="font-semibold">{workingClient.name}</span>. Anything you change is on
        their audit trail.
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={leave}
        className="ml-auto h-7 text-amber-900 hover:bg-amber-200 dark:text-amber-200 dark:hover:bg-amber-900"
      >
        <LogOut className="h-3.5 w-3.5" />
        Leave
      </Button>
    </div>
  )
}

export default WorkingClientBar
