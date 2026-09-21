import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  Bug,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  DollarSign,
  FileText,
  Hourglass,
  Lock,
  MapPin,
  Pencil,
  Phone,
  PlayCircle,
  Repeat,
  StickyNote,
  Timer,
  User as UserIcon,
  Wrench,
  XCircle,
} from 'lucide-react'

import { updateBookingStatus } from '@/api/bookings'
import { BookingStatusBadge } from '@/components/bookings/BookingStatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { LoadingState, Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { toastError, toastSuccess } from '@/components/ui/use-toast'
import { useBooking } from '@/hooks/useBookings'
import { toApiError } from '@/lib/api'
import {
  formatBookingDateTime,
  formatCurrency,
  formatDuration,
  formatTime,
} from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import {
  BOOKING_STATUS,
  BOOKING_STATUS_LABELS,
  EDITABLE_BOOKING_STATUSES,
  RECURRENCE_TYPES,
  UserRole,
} from '@/lib/constants'

function Field({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 dark:bg-slate-800">
        <Icon className="h-4 w-4 text-slate-500 dark:text-slate-400" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {label}
        </p>
        <p className="break-words text-sm font-medium text-slate-900 dark:text-slate-100">{value}</p>
      </div>
    </div>
  )
}

function NoteBlock({ icon: Icon, title, body, tone = 'default' }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <Icon
          className={
            tone === 'internal'
              ? 'h-4 w-4 text-amber-600 dark:text-amber-400'
              : 'h-4 w-4 text-slate-500 dark:text-slate-400'
          }
        />
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {title}
        </p>
      </div>
      <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
        {body?.trim() ? body : 'Nothing recorded.'}
      </p>
    </div>
  )
}

export function BookingDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const canWrite = useAuthStore((state) => state.canWrite())
  const isTechnician = user?.role === UserRole.TECHNICIAN

  const { booking, loading, error, refetch, setBooking } = useBooking(id)

  const [transitioning, setTransitioning] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelError, setCancelError] = useState(null)

  async function changeStatus(status, reason) {
    if (!booking) return null
    setTransitioning(true)
    try {
      const updated = await updateBookingStatus(booking.id, status, reason)
      setBooking(updated)
      toastSuccess(
        'Visit updated',
        `${booking.booking_number} is now ${BOOKING_STATUS_LABELS[status].toLowerCase()}.`,
      )
      return updated
    } catch (err) {
      const apiError = toApiError(err, 'Could not update this visit')
      toastError('Update failed', apiError.message)
      setCancelError(apiError.message)
      return null
    } finally {
      setTransitioning(false)
    }
  }

  /** Starting the visit opens its report; technicians go straight to it. */
  async function startVisit() {
    const updated = await changeStatus(BOOKING_STATUS.IN_PROGRESS)
    if (updated?.job_id && isTechnician) navigate(`/jobs/${updated.job_id}/report`)
  }

  async function submitCancellation() {
    setCancelError(null)
    const ok = await changeStatus(BOOKING_STATUS.CANCELLED, cancelReason.trim() || undefined)
    if (ok) {
      setCancelOpen(false)
      setCancelReason('')
    }
  }

  if (loading) {
    return <LoadingState message="Loading booking..." />
  }

  if (error || !booking) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" className="-ml-2" onClick={() => navigate('/bookings')}>
          <ArrowLeft className="h-4 w-4" />
          Back to bookings
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <AlertCircle className="h-10 w-10 text-red-500" />
            <div>
              <p className="font-medium text-slate-900 dark:text-slate-100">Booking not found</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {error?.message ?? 'This booking may have been removed.'}
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

  const isScheduled = booking.status === BOOKING_STATUS.SCHEDULED
  const isConfirmed = booking.status === BOOKING_STATUS.CONFIRMED
  const isAssigned = Boolean(booking.technician_id && booking.technician_id === user?.id)
  const canRunVisit = canWrite || isAssigned
  // Technicians fill the report in on the phone form; the office uses the full page.
  const reportPath = booking.job_id
    ? isTechnician
      ? `/jobs/${booking.job_id}/report`
      : `/jobs/${booking.job_id}`
    : null
  const isTerminal =
    booking.status === BOOKING_STATUS.COMPLETED || booking.status === BOOKING_STATUS.CANCELLED
  const editable = EDITABLE_BOOKING_STATUSES.includes(booking.status)
  const duration = booking.duration_minutes || booking.estimated_duration_minutes

  return (
    <div className="space-y-6">
      <Button variant="ghost" className="-ml-2" onClick={() => navigate('/bookings')}>
        <ArrowLeft className="h-4 w-4" />
        Back to bookings
      </Button>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
              {booking.booking_number}
            </h1>
            <BookingStatusBadge status={booking.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {formatBookingDateTime(booking.scheduled_start)} - {formatTime(booking.scheduled_end)}
            {booking.technician_name ? ` · ${booking.technician_name}` : ' · Unassigned'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canWrite && editable ? (
            <Button asChild variant="outline">
              <Link to={`/bookings/${booking.id}/edit`}>
                <Pencil className="h-4 w-4" />
                Edit
              </Link>
            </Button>
          ) : null}

          {booking.quote_id ? (
            <Button asChild variant="outline">
              <Link to={`/quotes/${booking.quote_id}`}>
                <FileText className="h-4 w-4" />
                View quote
              </Link>
            </Button>
          ) : null}

          {canWrite && isScheduled ? (
            <Button
              variant="outline"
              disabled={transitioning}
              onClick={() => void changeStatus(BOOKING_STATUS.CONFIRMED)}
            >
              <CheckCircle2 className="h-4 w-4" />
              Confirm
            </Button>
          ) : null}

          {canRunVisit && (isScheduled || isConfirmed) ? (
            <Button disabled={transitioning} onClick={() => void startVisit()}>
              {transitioning ? (
                <Spinner size="sm" className="text-white" />
              ) : (
                <PlayCircle className="h-4 w-4" />
              )}
              Start visit
            </Button>
          ) : null}

          {reportPath && !isTerminal ? (
            <Button asChild>
              <Link to={reportPath}>
                <ClipboardList className="h-4 w-4" />
                Open report
              </Link>
            </Button>
          ) : null}

          {reportPath && isTerminal ? (
            <Button asChild variant="outline">
              <Link to={`/jobs/${booking.job_id}`}>
                <ClipboardList className="h-4 w-4" />
                View report
              </Link>
            </Button>
          ) : null}

          {canWrite && !isTerminal ? (
            <Button
              variant="destructive"
              disabled={transitioning}
              onClick={() => {
                setCancelError(null)
                setCancelOpen(true)
              }}
            >
              <XCircle className="h-4 w-4" />
              Cancel
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Schedule</CardTitle>
              <CardDescription>When this visit is booked in.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <Field
                icon={CalendarClock}
                label="Scheduled start"
                value={formatBookingDateTime(booking.scheduled_start)}
              />
              <Field
                icon={CalendarClock}
                label="Scheduled end"
                value={formatBookingDateTime(booking.scheduled_end)}
              />
              <Field icon={Timer} label="Duration" value={formatDuration(duration)} />
              <Field
                icon={Hourglass}
                label="Estimated duration"
                value={formatDuration(booking.estimated_duration_minutes)}
              />
              {booking.actual_start ? (
                <Field
                  icon={PlayCircle}
                  label="Actual start"
                  value={formatBookingDateTime(booking.actual_start)}
                />
              ) : null}
              {booking.actual_end ? (
                <Field
                  icon={CheckCircle2}
                  label="Actual end"
                  value={formatBookingDateTime(booking.actual_end)}
                />
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Service</CardTitle>
              <CardDescription>What is being carried out on site.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field icon={ClipboardList} label="Service type" value={booking.service_type} />
                <Field
                  icon={Repeat}
                  label="Recurrence"
                  value={RECURRENCE_TYPES[booking.recurrence] ?? 'One-off'}
                />
                <Field
                  icon={DollarSign}
                  label="Quoted amount"
                  value={
                    booking.quoted_amount === null || booking.quoted_amount === undefined
                      ? '--'
                      : formatCurrency(booking.quoted_amount)
                  }
                />
                {booking.quote_number ? (
                  <Field icon={FileText} label="From quote" value={booking.quote_number} />
                ) : null}
              </div>

              <Separator />

              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Bug className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Pest types
                  </p>
                </div>
                {booking.pest_types?.length ? (
                  <div className="flex flex-wrap gap-2">
                    {booking.pest_types.map((pest) => (
                      <span
                        key={pest}
                        className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                      >
                        {pest}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500 dark:text-slate-400">None recorded.</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
              <CardDescription>
                {isTechnician
                  ? 'Instructions for this visit.'
                  : 'Instructions for the customer, the technician and the office.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <NoteBlock
                icon={StickyNote}
                title="Customer instructions"
                body={booking.customer_notes}
              />
              <Separator />
              <NoteBlock icon={Wrench} title="Technician notes" body={booking.technician_notes} />
              {!isTechnician ? (
                <>
                  <Separator />
                  <NoteBlock
                    icon={Lock}
                    title="Internal notes (office only)"
                    body={booking.internal_notes}
                    tone="internal"
                  />
                </>
              ) : null}
              {booking.cancellation_reason ? (
                <>
                  <Separator />
                  <NoteBlock
                    icon={XCircle}
                    title="Cancellation reason"
                    body={booking.cancellation_reason}
                  />
                </>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <Field icon={UserIcon} label="Name" value={booking.customer_name ?? '--'} />
              <Field icon={Phone} label="Phone" value={booking.customer_phone ?? '--'} />
              <Field
                icon={MapPin}
                label="Service address"
                value={
                  booking.service_address
                    ? [
                        booking.service_address.street,
                        booking.service_address.city,
                        booking.service_address.county,
                        booking.service_address.postcode,
                      ]
                        .filter(Boolean)
                        .join(', ')
                    : (booking.customer_address ?? '--')
                }
              />
              <Button asChild variant="outline" size="sm" className="w-full">
                <Link to={`/customers/${booking.customer_id}`}>View customer</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Technician</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <Field
                icon={Wrench}
                label="Assigned to"
                value={booking.technician_name ?? 'Not yet assigned'}
              />
              {canWrite && editable && !booking.technician_id ? (
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link to={`/bookings/${booking.id}/edit`}>Assign a technician</Link>
                </Button>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Record</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <Field
                icon={CalendarClock}
                label="Created"
                value={formatBookingDateTime(booking.created_at)}
              />
              <Field
                icon={CalendarClock}
                label="Last updated"
                value={formatBookingDateTime(booking.updated_at)}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog
        open={cancelOpen}
        onOpenChange={(open) => {
          if (!transitioning) {
            setCancelOpen(open)
            if (!open) {
              setCancelReason('')
              setCancelError(null)
            }
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this booking</DialogTitle>
            <DialogDescription>
              {booking.booking_number} will be marked as cancelled. Record why, so the office has a
              record of what happened.
            </DialogDescription>
          </DialogHeader>

          {cancelError ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{cancelError}</span>
            </div>
          ) : null}

          <Textarea
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
            rows={4}
            placeholder="Customer rescheduled to a later date."
            aria-label="Cancellation reason"
          />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={transitioning}
              onClick={() => setCancelOpen(false)}
            >
              Keep booking
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={transitioning}
              onClick={() => void submitCancellation()}
            >
              {transitioning ? <Spinner size="sm" className="text-white" /> : null}
              {transitioning ? 'Cancelling...' : 'Cancel booking'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default BookingDetailPage
