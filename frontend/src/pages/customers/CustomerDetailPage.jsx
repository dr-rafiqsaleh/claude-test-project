import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  CalendarClock,
  FileText,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Smartphone,
  StickyNote,
  Wrench,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { LoadingState } from '@/components/ui/spinner'
import { useCustomer } from '@/hooks/useCustomers'
import { formatDateTime } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'

function Field({ icon: Icon, label, value, href }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 dark:bg-slate-800">
        <Icon className="h-4 w-4 text-slate-500 dark:text-slate-400" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {label}
        </p>
        {href && value !== '--' ? (
          <a
            href={href}
            className="break-words text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            {value}
          </a>
        ) : (
          <p className="break-words text-sm font-medium text-slate-900 dark:text-slate-100">{value}</p>
        )}
      </div>
    </div>
  )
}

const PLACEHOLDER_SECTIONS = [
  {
    title: 'Bookings',
    description: 'Scheduled visits and recurring services will appear here.',
    icon: CalendarClock,
  },
  {
    title: 'Jobs',
    description: 'Completed treatments and service reports will appear here.',
    icon: Wrench,
  },
]

export function CustomerDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const canWrite = useAuthStore((state) => state.canWrite())
  const { customer, loading, error, refetch } = useCustomer(id)

  if (loading) {
    return <LoadingState message="Loading customer..." />
  }

  if (error || !customer) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate('/customers')}>
          <ArrowLeft className="h-4 w-4" />
          Back to customers
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <AlertCircle className="h-10 w-10 text-red-500" />
            <div>
              <p className="font-medium text-slate-900 dark:text-slate-100">Customer not found</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {error?.message ?? 'This customer may have been removed.'}
              </p>
            </div>
            <Button variant="outline" onClick={() => void refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const { address } = customer

  return (
    <div className="space-y-6">
      <Button variant="ghost" className="-ml-2" onClick={() => navigate('/customers')}>
        <ArrowLeft className="h-4 w-4" />
        Back to customers
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
              {customer.first_name} {customer.last_name}
            </h1>
            <Badge variant={customer.is_active ? 'default' : 'secondary'}>
              {customer.is_active ? 'Active' : 'Archived'}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Added {formatDateTime(customer.created_at)} &middot; Last updated{' '}
            {formatDateTime(customer.updated_at)}
          </p>
        </div>

        {canWrite ? (
          <Button asChild>
            <Link to={`/customers/${customer.id}/edit`}>
              <Pencil className="h-4 w-4" />
              Edit customer
            </Link>
          </Button>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Contact details</CardTitle>
            <CardDescription>How to reach this customer and where they are located.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                icon={Phone}
                label="Phone"
                value={customer.phone}
                href={`tel:${customer.phone.replace(/\s/g, '')}`}
              />
              <Field
                icon={Smartphone}
                label="Mobile"
                value={customer.mobile ?? '--'}
                href={customer.mobile ? `tel:${customer.mobile.replace(/\s/g, '')}` : undefined}
              />
              <Field
                icon={Mail}
                label="Email"
                value={customer.email ?? '--'}
                href={customer.email ? `mailto:${customer.email}` : undefined}
              />
            </div>

            <Separator />

            <div className="grid gap-5 sm:grid-cols-2">
              <Field icon={MapPin} label="Street" value={address.street} />
              <Field icon={MapPin} label="Town / City" value={address.city} />
              {address.county ? (
                <Field icon={MapPin} label="County" value={address.county} />
              ) : null}
              <Field icon={MapPin} label="Postcode" value={address.postcode} />
              <Field icon={MapPin} label="Country" value={address.country} />
            </div>

            <Separator />

            <Field icon={StickyNote} label="Notes" value={customer.notes?.trim() || 'No notes recorded.'} />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-emerald-600" />
                  <CardTitle className="text-base">Quotes</CardTitle>
                </div>
                <Badge variant="default">Available</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Raise and track quotes for this customer.
              </p>
              <div className="flex flex-col gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link to={`/quotes?customer_id=${customer.id}`}>View quotes</Link>
                </Button>
                {canWrite ? (
                  <Button asChild size="sm">
                    <Link to={`/quotes/new?customer_id=${customer.id}`}>New quote</Link>
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {PLACEHOLDER_SECTIONS.map((section) => {
            const Icon = section.icon
            return (
              <Card key={section.title}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-emerald-600" />
                      <CardTitle className="text-base">{section.title}</CardTitle>
                    </div>
                    <Badge variant="secondary">Coming soon</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border border-dashed border-slate-300 px-4 py-6 text-center dark:border-slate-700">
                    <p className="text-xs text-slate-500 dark:text-slate-400">{section.description}</p>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default CustomerDetailPage
