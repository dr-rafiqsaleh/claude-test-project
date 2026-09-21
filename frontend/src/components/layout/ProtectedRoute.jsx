import { Navigate, useLocation } from 'react-router-dom'

import { LoadingState } from '@/components/ui/spinner'
import { useAuthStore } from '@/store/authStore'

/**
 * Blocks rendering until the session has been restored, then redirects
 * unauthenticated visitors to /login (preserving the intended destination).
 */
export function ProtectedRoute({ children }) {
  const location = useLocation()
  const status = useAuthStore((state) => state.status)
  const accessToken = useAuthStore((state) => state.accessToken)
  const user = useAuthStore((state) => state.user)

  if (status === 'idle' || status === 'restoring') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <LoadingState message="Restoring your session..." />
      </div>
    )
  }

  if (!accessToken || !user) {
    return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />
  }

  return <>{children}</>
}

export default ProtectedRoute
