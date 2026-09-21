import { useState } from 'react'
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
  RotateCcw,
  Smartphone,
  StickyNote,
  Wrench,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DetailField, PageHeader } from '@/components/ui/page'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { LoadingState } from '@/components/ui/spinner'
import { updateCustomer } from '@/api/customers'
import { toastError, toastSuccess } from '@/components/ui/use-toast'
import { useCustomer } from '@/hooks/useCustomers'
import { toApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'


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
  const [restoring, setRestoring] = useState(false)

  async function handleRestore() {
    setRestoring(true)
    try {
      await updateCustomer(customer.id, { is_active: true })
      await refetch()
      toastSuccess('Customer restored', `${customer.first_name} ${customer.last_name} is active again.`)
    } catch (err) {
      toastError('Could not restore customer', toApiError(err).message)
    } finally {
      setRestoring(false)
    }
  }

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
            <AlertCircle className="h-10 w-10 text-destructive" />
            <div>
              <p className="font-medium text-foreground">Customer not found</p>
              <p className="mt-1 text-sm text-muted-foreground">
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
      <PageHeader
        backTo="/customers"
        backLabel="Back to customers"
        title={
          <>
            {customer.first_name} {customer.last_name}
          </>
        }
        badge={<Badge variant={customer.is_active ? 'default' : 'secondary'}>
          {customer.is_active ? 'Active' : 'Archived'}
        </Badge>}
        description={
          <>
            Added {formatDateTime(customer.created_at)} &middot; Last updated{' '}
            {formatDateTime(customer.updated_at)}
          </>
        }
        actions={canWrite ? (
          <div className="flex flex-wrap gap-2">
            {!customer.is_active ? (
              <Button variant="outline" disabled={restoring} onClick={() => void handleRestore()}>
                <RotateCcw className="h-4 w-4" />
                {restoring ? 'Restoring...' : 'Restore customer'}
              </Button>
            ) : null}
            <Button asChild>
              <Link to={`/customers/${customer.id}/edit`}>
                <Pencil className="h-4 w-4" />
                Edit customer
              </Link>
            </Button>
          </div>
        ) : null}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Contact details</CardTitle>
            <CardDescription>How to reach this customer and where they are located.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <DetailField
                icon={Phone}
                label="Phone"
                value={customer.phone}
                href={`tel:${customer.phone.replace(/\s/g, '')}`}
              />
              <DetailField
                icon={Smartphone}
                label="Mobile"
                value={customer.mobile ?? '--'}
                href={customer.mobile ? `tel:${customer.mobile.replace(/\s/g, '')}` : undefined}
              />
              <DetailField
                icon={Mail}
                label="Email"
                value={customer.email ?? '--'}
                href={customer.email ? `mailto:${customer.email}` : undefined}
              />
            </div>

            <Separator />

            <div className="grid gap-5 sm:grid-cols-2">
              <DetailField icon={MapPin} label="Street" value={address.street} />
              <DetailField icon={MapPin} label="Town / City" value={address.city} />
              {address.county ? (
                <DetailField icon={MapPin} label="County" value={address.county} />
              ) : null}
              <DetailField icon={MapPin} label="Postcode" value={address.postcode} />
              <DetailField icon={MapPin} label="Country" value={address.country} />
            </div>

            <Separator />

            <DetailField icon={StickyNote} label="Notes" value={customer.notes?.trim() || 'No notes recorded.'} />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  <CardTitle className="text-base">Quotes</CardTitle>
                </div>
                <Badge variant="default">Available</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
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
                      <Icon className="h-4 w-4 text-primary" />
                      <CardTitle className="text-base">{section.title}</CardTitle>
                    </div>
                    <Badge variant="secondary">Coming soon</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border border-dashed border-input px-4 py-6 text-center">
                    <p className="text-xs text-muted-foreground">{section.description}</p>
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
