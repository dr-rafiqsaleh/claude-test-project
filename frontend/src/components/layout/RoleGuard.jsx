import { Link, Navigate } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/store/authStore'
import { ROLE_LABELS } from '@/lib/constants'

/** Renders children only for the allowed roles; otherwise a 403 panel (or redirect). */
export function RoleGuard({ allow, children, redirectTo }) {
  const user = useAuthStore((state) => state.user)

  if (user && allow.includes(user.role)) {
    return <>{children}</>
  }

  if (redirectTo) {
    return <Navigate to={redirectTo} replace />
  }

  return (
    <div className="flex items-start justify-center py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/15">
            <ShieldAlert className="h-6 w-6 text-destructive" />
          </div>
          <CardTitle>403 - Access denied</CardTitle>
          <CardDescription>
            {user
              ? `Your ${ROLE_LABELS[user.role]} account does not have permission to view this page.`
              : 'You do not have permission to view this page.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button asChild variant="outline">
            <Link to="/dashboard">Back to dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

export default RoleGuard
