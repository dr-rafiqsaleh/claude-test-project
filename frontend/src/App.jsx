import { Suspense, lazy, useEffect } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'

import { getMe, hasSession } from '@/api/auth'
import { AppShell } from '@/components/layout/AppShell'
import { ProtectedRoute } from '@/components/layout/ProtectedRoute'
import { RoleGuard } from '@/components/layout/RoleGuard'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingState } from '@/components/ui/spinner'
import { Toaster } from '@/components/ui/toaster'
import { useAuthStore } from '@/store/authStore'

// Pages load on first visit, so a phone downloads only the screens it opens.
const DashboardPage = lazy(() => import('@/pages/DashboardPage'))
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage'))
const SearchPage = lazy(() => import('@/pages/SearchPage'))
const LoginPage = lazy(() => import('@/pages/auth/LoginPage'))
const BookingDetailPage = lazy(() => import('@/pages/bookings/BookingDetailPage'))
const BookingFormPage = lazy(() => import('@/pages/bookings/BookingFormPage'))
const BookingsPage = lazy(() => import('@/pages/bookings/BookingsPage'))
const CustomerDetailPage = lazy(() => import('@/pages/customers/CustomerDetailPage'))
const CustomerFormPage = lazy(() => import('@/pages/customers/CustomerFormPage'))
const CustomersPage = lazy(() => import('@/pages/customers/CustomersPage'))
const InvoiceDetailPage = lazy(() => import('@/pages/invoices/InvoiceDetailPage'))
const InvoiceFormPage = lazy(() => import('@/pages/invoices/InvoiceFormPage'))
const InvoicesPage = lazy(() => import('@/pages/invoices/InvoicesPage'))
const JobDetailPage = lazy(() => import('@/pages/jobs/JobDetailPage'))
const JobReportFormPage = lazy(() => import('@/pages/jobs/JobReportFormPage'))
const JobsPage = lazy(() => import('@/pages/jobs/JobsPage'))
const QuoteDetailPage = lazy(() => import('@/pages/quotes/QuoteDetailPage'))
const QuoteFormPage = lazy(() => import('@/pages/quotes/QuoteFormPage'))
const QuotesPage = lazy(() => import('@/pages/quotes/QuotesPage'))
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'))
const UsersPage = lazy(() => import('@/pages/users/UsersPage'))
const ClientsPage = lazy(() => import('@/pages/platform/ClientsPage'))
const EnquiriesPage = lazy(() => import('@/pages/platform/EnquiriesPage'))
const AuditPage = lazy(() => import('@/pages/audit/AuditPage'))
const PlatformSettingsPage = lazy(() => import('@/pages/platform/PlatformSettingsPage'))

/**
 * Where a signed-in person lands.
 *
 * PestBase's own staff belong to no client, so the dashboard - which is entirely a
 * client's own jobs, quotes and invoices - has nothing to show them and every
 * request it makes is refused for want of a client. They start on the client
 * list instead, which is their actual work.
 */
function HomeRedirect() {
  const isPlatformStaff = useAuthStore((state) => Boolean(state.user?.is_platform_staff))
  return <Navigate to={isPlatformStaff ? '/platform/clients' : '/dashboard'} replace />
}

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
 * Works out on first load whether somebody is signed in.
 *
 * SuperTokens owns the session and refreshes it itself, so there is no token to
 * restore - the question is only whether a session exists and, if it does, which
 * PestBase account is behind it. `doesSessionExist` answers the first without a
 * round trip, so a signed-out visitor reaches the sign-in page immediately.
 */
function useSessionBootstrap() {
  const setStatus = useAuthStore((state) => state.setStatus)
  const setUser = useAuthStore((state) => state.setUser)
  const clear = useAuthStore((state) => state.clear)

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      setStatus('restoring')

      if (!(await hasSession())) {
        if (!cancelled) clear()
        return
      }

      try {
        const user = await getMe()
        if (cancelled) return
        setUser(user)
      } catch {
        if (cancelled) return

        // A chosen client can be refused - its support access may have run out
        // since it was picked - and that is not a reason to sign anybody out.
        // Step back out of it and ask again as ourselves.
        if (useAuthStore.getState().workingClient) {
          useAuthStore.getState().setWorkingClient(null)
          try {
            setUser(await getMe())
            return
          } catch {
            /* falls through to signing out, below */
          }
        }

        // A session the API will not accept: deactivated, or its client
        // suspended. Treated as signed out, which sends them to /login.
        clear()
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [setStatus, setUser, clear])
}

export function App() {
  useSessionBootstrap()

  return (
    <>
      <Routes>
        {/* /login and /login/verify, which is where an emailed link lands. */}
        <Route
          path="/login/*"
          element={
            <Suspense fallback={<LoadingState className="min-h-dvh" />}>
              <LoginPage />
            </Suspense>
          }
        />

        <Route
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route index element={<HomeRedirect />} />
          <Route path="/dashboard" element={<DashboardPage />} />

          <Route path="/search" element={<SearchPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />

          <Route path="/customers" element={<CustomersPage />} />
          <Route
            path="/customers/new"
            element={
              <RoleGuard permission="customers.edit">
                <CustomerFormPage />
              </RoleGuard>
            }
          />
          <Route path="/customers/:id" element={<CustomerDetailPage />} />
          <Route
            path="/customers/:id/edit"
            element={
              <RoleGuard permission="customers.edit">
                <CustomerFormPage />
              </RoleGuard>
            }
          />

          <Route path="/quotes" element={<QuotesPage />} />
          <Route
            path="/quotes/new"
            element={
              <RoleGuard permission="quotes.edit">
                <QuoteFormPage />
              </RoleGuard>
            }
          />
          <Route path="/quotes/:id" element={<QuoteDetailPage />} />
          <Route
            path="/quotes/:id/edit"
            element={
              <RoleGuard permission="quotes.edit">
                <QuoteFormPage />
              </RoleGuard>
            }
          />

          <Route path="/bookings" element={<BookingsPage />} />
          <Route
            path="/bookings/new"
            element={
              <RoleGuard permission="jobs.edit">
                <BookingFormPage />
              </RoleGuard>
            }
          />
          <Route path="/bookings/:id" element={<BookingDetailPage />} />
          <Route
            path="/bookings/:id/edit"
            element={
              <RoleGuard permission="jobs.edit">
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
              <RoleGuard permission="invoices.view">
                <InvoicesPage />
              </RoleGuard>
            }
          />
          <Route
            path="/invoices/new"
            element={
              <RoleGuard permission="invoices.edit">
                <InvoiceFormPage />
              </RoleGuard>
            }
          />
          <Route
            path="/invoices/:id"
            element={
              <RoleGuard permission="invoices.view">
                <InvoiceDetailPage />
              </RoleGuard>
            }
          />
          <Route
            path="/invoices/:id/edit"
            element={
              <RoleGuard permission="invoices.edit">
                <InvoiceFormPage />
              </RoleGuard>
            }
          />

          <Route
            path="/users"
            element={
              <RoleGuard permission="users.manage">
                <UsersPage />
              </RoleGuard>
            }
          />

          <Route
            path="/audit"
            element={
              <RoleGuard permission="audit.view">
                <AuditPage />
              </RoleGuard>
            }
          />

          <Route
            path="/platform/settings"
            element={
              <RoleGuard platform>
                <PlatformSettingsPage />
              </RoleGuard>
            }
          />

          <Route
            path="/platform/enquiries"
            element={
              <RoleGuard platform>
                <EnquiriesPage />
              </RoleGuard>
            }
          />

          <Route
            path="/platform/clients"
            element={
              <RoleGuard platform>
                <ClientsPage />
              </RoleGuard>
            }
          />

          <Route
            path="/settings"
            element={
              <RoleGuard permission="settings.manage">
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
