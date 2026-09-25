import { Link, Navigate } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/store/authStore'
import { ROLE_LABELS } from '@/lib/constants'

/**
 * Renders children only when the user may see them; otherwise a 403 panel (or
 * redirect). Prefer `permission` - it matches what the API actually checks, so
 * a custom role that was given the permission gets in. `allow` lists role keys.
 * `platform` is for PestBase's own pages: a client's Admin role holds every
 * permission there is, so platform access can never be one of them.
 */
export function RoleGuard({ allow, permission, platform, children, redirectTo }) {
  const user = useAuthStore((state) => state.user)

  let allowed
  if (platform) allowed = Boolean(user?.is_platform_staff)
  else if (permission) allowed = Boolean(user?.permissions?.includes(permission))
  else allowed = Boolean(user && allow?.includes(user.role))

  if (allowed) {
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
              ? `Your ${user.role_name ?? ROLE_LABELS[user.role] ?? user.role} account does not have permission to view this page.`
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
