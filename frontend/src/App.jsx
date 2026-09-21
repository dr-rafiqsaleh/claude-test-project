import { useEffect } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'

import { getMe } from '@/api/auth'
import { AppShell } from '@/components/layout/AppShell'
import { ProtectedRoute } from '@/components/layout/ProtectedRoute'
import { RoleGuard } from '@/components/layout/RoleGuard'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Toaster } from '@/components/ui/toaster'
import { refreshAccessToken } from '@/lib/api'
import { readRefreshToken, useAuthStore } from '@/store/authStore'
import { UserRole } from '@/lib/constants'

import DashboardPage from '@/pages/DashboardPage'
import NotificationsPage from '@/pages/NotificationsPage'
import SearchPage from '@/pages/SearchPage'
import LoginPage from '@/pages/auth/LoginPage'
import BookingDetailPage from '@/pages/bookings/BookingDetailPage'
import BookingFormPage from '@/pages/bookings/BookingFormPage'
import BookingsPage from '@/pages/bookings/BookingsPage'
import CustomerDetailPage from '@/pages/customers/CustomerDetailPage'
import CustomerFormPage from '@/pages/customers/CustomerFormPage'
import CustomersPage from '@/pages/customers/CustomersPage'
import InvoiceDetailPage from '@/pages/invoices/InvoiceDetailPage'
import InvoiceFormPage from '@/pages/invoices/InvoiceFormPage'
import InvoicesPage from '@/pages/invoices/InvoicesPage'
import JobDetailPage from '@/pages/jobs/JobDetailPage'
import JobReportFormPage from '@/pages/jobs/JobReportFormPage'
import JobsPage from '@/pages/jobs/JobsPage'
import QuoteDetailPage from '@/pages/quotes/QuoteDetailPage'
import QuoteFormPage from '@/pages/quotes/QuoteFormPage'
import QuotesPage from '@/pages/quotes/QuotesPage'
import SettingsPage from '@/pages/settings/SettingsPage'
import UsersPage from '@/pages/users/UsersPage'

const WRITE_ROLES = [UserRole.ADMIN, UserRole.OFFICE_STAFF]

function NotFoundPage() {
  return (
    <div className="flex items-start justify-center py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>404 - Page not found</CardTitle>
          <CardDescription>The page you were looking for does not exist.</CardDescription>
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

/**
 * Restores the session on first load: the access token lives in memory only, so
 * a page refresh exchanges the stored refresh token for a new one.
 */
function useSessionBootstrap() {
  const setStatus = useAuthStore((state) => state.setStatus)
  const setUser = useAuthStore((state) => state.setUser)
  const logout = useAuthStore((state) => state.logout)

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      if (!readRefreshToken()) {
        if (!cancelled) setStatus('unauthenticated')
        return
      }

      setStatus('restoring')

      const token = await refreshAccessToken()
      if (cancelled) return

      if (!token) {
        logout()
        return
      }

      try {
        const user = await getMe()
        if (cancelled) return
        setUser(user)
        setStatus('authenticated')
      } catch {
        if (!cancelled) logout()
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [setStatus, setUser, logout])
}

export function App() {
  useSessionBootstrap()

  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />

          <Route path="/search" element={<SearchPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />

          <Route path="/customers" element={<CustomersPage />} />
          <Route
            path="/customers/new"
            element={
              <RoleGuard allow={WRITE_ROLES}>
                <CustomerFormPage />
              </RoleGuard>
            }
          />
          <Route path="/customers/:id" element={<CustomerDetailPage />} />
          <Route
            path="/customers/:id/edit"
            element={
              <RoleGuard allow={WRITE_ROLES}>
                <CustomerFormPage />
              </RoleGuard>
            }
          />

          <Route path="/quotes" element={<QuotesPage />} />
          <Route
            path="/quotes/new"
            element={
              <RoleGuard allow={WRITE_ROLES}>
                <QuoteFormPage />
              </RoleGuard>
            }
          />
          <Route path="/quotes/:id" element={<QuoteDetailPage />} />
          <Route
            path="/quotes/:id/edit"
            element={
              <RoleGuard allow={WRITE_ROLES}>
                <QuoteFormPage />
              </RoleGuard>
            }
          />

          <Route path="/bookings" element={<BookingsPage />} />
          <Route
            path="/bookings/new"
            element={
              <RoleGuard allow={WRITE_ROLES}>
                <BookingFormPage />
              </RoleGuard>
            }
          />
          <Route path="/bookings/:id" element={<BookingDetailPage />} />
          <Route
            path="/bookings/:id/edit"
            element={
              <RoleGuard allow={WRITE_ROLES}>
                <BookingFormPage />
              </RoleGuard>
            }
          />

          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/jobs/:id" element={<JobDetailPage />} />
          {/* Mobile technician portal - rendered without the sidebar. */}
          <Route path="/jobs/:id/report" element={<JobReportFormPage />} />

          <Route
            path="/invoices"
            element={
              <RoleGuard allow={WRITE_ROLES}>
                <InvoicesPage />
              </RoleGuard>
            }
          />
          <Route
            path="/invoices/new"
            element={
              <RoleGuard allow={WRITE_ROLES}>
                <InvoiceFormPage />
              </RoleGuard>
            }
          />
          <Route
            path="/invoices/:id"
            element={
              <RoleGuard allow={WRITE_ROLES}>
                <InvoiceDetailPage />
              </RoleGuard>
            }
          />
          <Route
            path="/invoices/:id/edit"
            element={
              <RoleGuard allow={WRITE_ROLES}>
                <InvoiceFormPage />
              </RoleGuard>
            }
          />

          <Route
            path="/users"
            element={
              <RoleGuard allow={[UserRole.ADMIN]}>
                <UsersPage />
              </RoleGuard>
            }
          />

          <Route
            path="/settings"
            element={
              <RoleGuard allow={[UserRole.ADMIN]}>
                <SettingsPage />
              </RoleGuard>
            }
          />

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>

      <Toaster />
    </>
  )
}

export default App
