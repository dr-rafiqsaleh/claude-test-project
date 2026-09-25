import { Navigate, useLocation } from 'react-router-dom'

import { LoadingState } from '@/components/ui/spinner'
import { useAuthStore } from '@/store/authStore'

/**
 * Blocks rendering until we know whether there is a session, then sends anyone
 * without one to /login, keeping where they were headed.
 *
 * `user` rather than a token: SuperTokens owns the session, and what this needs
 * to know is whether the PestBase profile behind it has loaded - that profile is
 * what every permission check reads.
 */
export function ProtectedRoute({ children }) {
  const location = useLocation()
  const status = useAuthStore((state) => state.status)
  const user = useAuthStore((state) => state.user)

  if (status === 'idle' || status === 'restoring') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/50">
        <LoadingState message="Restoring your session..." />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />
  }

  return <>{children}</>
}

export default ProtectedRoute
