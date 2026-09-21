import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import {
  AlertCircle,
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Eye,
  List as ListIcon,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { BookingStatusBadge } from '@/components/bookings/BookingStatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingState, Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toastError, toastSuccess } from '@/components/ui/use-toast'
import { useBookings, useCalendarEvents, useTechnicians } from '@/hooks/useBookings'
import { useDebounce } from '@/hooks/useDebounce'
import { toApiError } from '@/lib/api'
import { cn, formatBookingDateTime, formatDuration } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import {
  ALL_BOOKING_STATUSES,
  BOOKING_STATUS,
  BOOKING_STATUS_LABELS,
  DELETABLE_BOOKING_STATUSES,
  EDITABLE_BOOKING_STATUSES,
  UserRole,
} from '@/lib/constants'

const PAGE_SIZE = 20
const ANY = '__any__'

const SELECT_CLASSES =
  'flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'

const CALENDAR_VIEWS = [
  { key: 'timeGridDay', label: 'Day' },
  { key: 'timeGridWeek', label: 'Week' },
  { key: 'dayGridMonth', label: 'Month' },
]

/** Shorten a long service type so it fits inside a calendar chip. */
function abbreviateService(serviceType) {
  if (!serviceType) return ''
  const words = serviceType.split(/\s+/).filter(Boolean)
  if (words.length <= 2 && serviceType.length <= 18) return serviceType
  const initials = words.map((word) => word[0].toUpperCase()).join('')
  return initials.length >= 2 ? initials : serviceType.slice(0, 12)
}

export function BookingsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const user = useAuthStore((state) => state.user)
  const canWrite = useAuthStore((state) => state.canWrite())
  const isAdmin = useAuthStore((state) => state.isAdmin())

  const view = searchParams.get('view') === 'calendar' ? 'calendar' : 'list'
  const customerId = searchParams.get('customer_id') ?? ''

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState(ANY)
  const [technicianFilter, setTechnicianFilter] = useState(ANY)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [pendingCancel, setPendingCancel] = useState(null)
  const [working, setWorking] = useState(false)

  const debouncedSearch = useDebounce(search, 350)
  const { technicians } = useTechnicians(canWrite)

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, statusFilter, technicianFilter, dateFrom, dateTo, customerId])

  const listParams = useMemo(() => {
    const next = { page, page_size: PAGE_SIZE }
    if (debouncedSearch.trim()) next.q = debouncedSearch.trim()
    if (statusFilter !== ANY) next.status = statusFilter
    if (technicianFilter !== ANY) next.technician_id = technicianFilter
    if (customerId) next.customer_id = customerId
    if (dateFrom) next.date_from = new Date(`${dateFrom}T00:00:00`).toISOString()
    if (dateTo) next.date_to = new Date(`${dateTo}T23:59:59`).toISOString()
    return next
  }, [page, debouncedSearch, statusFilter, technicianFilter, customerId, dateFrom, dateTo])

  const { bookings, total, totalPages, loading, error, remove, updateStatus, refetch } =
    useBookings(listParams)

  function setView(nextView) {
    const next = new URLSearchParams(searchParams)
    if (nextView === 'calendar') next.set('view', 'calendar')
    else next.delete('view')
    setSearchParams(next, { replace: true })
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setWorking(true)
    try {
      await remove(pendingDelete.id)
      toastSuccess('Booking deleted', `${pendingDelete.booking_number} was removed.`)
      setPendingDelete(null)
    } catch (err) {
      toastError('Could not delete booking', toApiError(err).message)
    } finally {
      setWorking(false)
    }
  }

  async function confirmCancel() {
    if (!pendingCancel) return
    setWorking(true)
    try {
      await updateStatus(pendingCancel.id, BOOKING_STATUS.CANCELLED)
      toastSuccess('Booking cancelled', `${pendingCancel.booking_number} is now cancelled.`)
      setPendingCancel(null)
    } catch (err) {
      toastError('Could not cancel booking', toApiError(err).message)
    } finally {
      setWorking(false)
    }
  }

  const isFiltered =
    Boolean(debouncedSearch.trim()) ||
    statusFilter !== ANY ||
    technicianFilter !== ANY ||
    Boolean(dateFrom) ||
    Boolean(dateTo) ||
    Boolean(customerId)

  function clearFilters() {
    setSearch('')
    setStatusFilter(ANY)
    setTechnicianFilter(ANY)
    setDateFrom('')
    setDateTo('')
    const next = new URLSearchParams(searchParams)
    next.delete('customer_id')
    setSearchParams(next, { replace: true })
  }

  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(page * PAGE_SIZE, total)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Bookings
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {user?.role === UserRole.TECHNICIAN
              ? 'The jobs scheduled for you.'
              : 'Schedule technicians and keep the service calendar up to date.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-slate-300 p-0.5 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setView('list')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors',
                view === 'list'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
              )}
            >
              <ListIcon className="h-4 w-4" />
              List
            </button>
            <button
              type="button"
              onClick={() => setView('calendar')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors',
                view === 'calendar'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
              )}
            >
              <CalendarDays className="h-4 w-4" />
              Calendar
            </button>
          </div>

          {canWrite ? (
            <Button asChild>
              <Link to="/bookings/new">
                <Plus className="h-4 w-4" />
                New booking
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      {view === 'calendar' ? (
        <BookingsCalendar
          technicians={technicians}
          canFilterTechnician={canWrite}
          onSelectBooking={(id) => navigate(`/bookings/${id}`)}
        />
      ) : (
        <>
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search by booking number, customer or service..."
                    className="pl-9"
                    aria-label="Search bookings"
                  />
                </div>

                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className={cn(SELECT_CLASSES, 'lg:w-[170px]')}
                  aria-label="Filter by status"
                >
                  <option value={ANY}>All statuses</option>
                  {ALL_BOOKING_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {BOOKING_STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>

                {canWrite ? (
                  <select
                    value={technicianFilter}
                    onChange={(event) => setTechnicianFilter(event.target.value)}
                    className={cn(SELECT_CLASSES, 'lg:w-[200px]')}
                    aria-label="Filter by technician"
                  >
                    <option value={ANY}>All technicians</option>
                    {technicians.map((technician) => (
                      <option key={technician.id} value={technician.id}>
                        {technician.full_name}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="space-y-1.5">
                  <Label htmlFor="booking-date-from" className="text-xs text-slate-500">
                    From
                  </Label>
                  <Input
                    id="booking-date-from"
                    type="date"
                    value={dateFrom}
                    onChange={(event) => setDateFrom(event.target.value)}
                    className="sm:w-[170px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="booking-date-to" className="text-xs text-slate-500">
                    To
                  </Label>
                  <Input
                    id="booking-date-to"
                    type="date"
                    value={dateTo}
                    onChange={(event) => setDateTo(event.target.value)}
                    className="sm:w-[170px]"
                  />
                </div>

                {isFiltered ? (
                  <Button variant="outline" size="sm" onClick={clearFilters} className="sm:mb-0.5">
                    Clear filters
                  </Button>
                ) : null}
              </div>

              {customerId ? (
                <div className="flex items-center gap-2">
                  <Badge variant="info">Filtered to one customer</Badge>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            {loading ? (
              <LoadingState message="Loading bookings..." />
            ) : error ? (
              <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                <AlertCircle className="h-10 w-10 text-red-500" />
                <div>
                  <p className="font-medium text-slate-900 dark:text-slate-100">
                    Could not load bookings
                  </p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{error.message}</p>
                </div>
                <Button variant="outline" onClick={() => void refetch()}>
                  Try again
                </Button>
              </div>
            ) : bookings.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                  <CalendarClock className="h-6 w-6 text-slate-400" />
                </div>
                <div>
                  <p className="font-medium text-slate-900 dark:text-slate-100">
                    {isFiltered ? 'No bookings match your filters' : 'No bookings yet'}
                  </p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {isFiltered
                      ? 'Try a different search term or clear the filters.'
                      : 'Schedule your first booking to get started.'}
                  </p>
                </div>
                {isFiltered ? (
                  <Button variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : canWrite ? (
                  <Button asChild>
                    <Link to="/bookings/new">
                      <Plus className="h-4 w-4" />
                      New booking
                    </Link>
                  </Button>
                ) : null}
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Booking #</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead className="hidden lg:table-cell">Technician</TableHead>
                      <TableHead className="hidden md:table-cell">Service type</TableHead>
                      <TableHead>Scheduled start</TableHead>
                      <TableHead className="hidden sm:table-cell">Duration</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-12 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bookings.map((booking) => {
                      const editable = EDITABLE_BOOKING_STATUSES.includes(booking.status)
                      const deletable = DELETABLE_BOOKING_STATUSES.includes(booking.status)
                      return (
                        <TableRow
                          key={booking.id}
                          className="cursor-pointer"
                          onClick={() => navigate(`/bookings/${booking.id}`)}
                        >
                          <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                            {booking.booking_number}
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-400">
                            {booking.customer_name ?? '--'}
                          </TableCell>
                          <TableCell className="hidden text-slate-600 dark:text-slate-400 lg:table-cell">
                            {booking.technician_name ?? 'Unassigned'}
                          </TableCell>
                          <TableCell className="hidden text-slate-600 dark:text-slate-400 md:table-cell">
                            {booking.service_type}
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-400">
                            {formatBookingDateTime(booking.scheduled_start)}
                          </TableCell>
                          <TableCell className="hidden text-slate-600 dark:text-slate-400 sm:table-cell">
                            {formatDuration(
                              booking.duration_minutes || booking.estimated_duration_minutes,
                            )}
                          </TableCell>
                          <TableCell>
                            <BookingStatusBadge status={booking.status} />
                          </TableCell>
                          <TableCell className="text-right">
                            <div onClick={(event) => event.stopPropagation()}>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    aria-label="Row actions"
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onSelect={() => navigate(`/bookings/${booking.id}`)}
                                  >
                                    <Eye className="h-4 w-4" />
                                    View details
                                  </DropdownMenuItem>
                                  {canWrite && editable ? (
                                    <DropdownMenuItem
                                      onSelect={() => navigate(`/bookings/${booking.id}/edit`)}
                                    >
                                      <Pencil className="h-4 w-4" />
                                      Edit
                                    </DropdownMenuItem>
                                  ) : null}
                                  {canWrite && booking.status !== BOOKING_STATUS.CANCELLED &&
                                  booking.status !== BOOKING_STATUS.COMPLETED ? (
                                    <DropdownMenuItem onSelect={() => setPendingCancel(booking)}>
                                      <XCircle className="h-4 w-4" />
                                      Cancel booking
                                    </DropdownMenuItem>
                                  ) : null}
                                  {isAdmin && deletable ? (
                                    <>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        onSelect={() => setPendingDelete(booking)}
                                        className="text-red-600 focus:bg-red-50 focus:text-red-700 dark:text-red-400 dark:focus:bg-red-950"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                        Delete
                                      </DropdownMenuItem>
                                    </>
                                  ) : null}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>

                <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 sm:flex-row dark:border-slate-800">
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Showing <span className="font-medium">{rangeStart}</span>-
                    <span className="font-medium">{rangeEnd}</span> of{' '}
                    <span className="font-medium">{total}</span>
                  </p>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </Button>
                    <span className="px-2 text-sm text-slate-600 dark:text-slate-400">
                      Page {page} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </Card>
        </>
      )}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !working) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this booking?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `${pendingDelete.booking_number} will be permanently deleted. Only scheduled or cancelled bookings can be removed, and this cannot be undone.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Keep booking</AlertDialogCancel>
            <AlertDialogAction
              disabled={working}
              className="bg-red-600 hover:bg-red-700"
              onClick={(event) => {
                event.preventDefault()
                void confirmDelete()
              }}
            >
              {working ? 'Deleting...' : 'Delete booking'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingCancel !== null}
        onOpenChange={(open) => {
          if (!open && !working) setPendingCancel(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this booking?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingCancel
                ? `${pendingCancel.booking_number} will be marked as cancelled. Cancelled bookings cannot be reactivated.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Keep booking</AlertDialogCancel>
            <AlertDialogAction
              disabled={working}
              className="bg-red-600 hover:bg-red-700"
              onClick={(event) => {
                event.preventDefault()
                void confirmCancel()
              }}
            >
              {working ? 'Cancelling...' : 'Cancel booking'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** FullCalendar view with its own date range, technician filter and toolbar. */
function BookingsCalendar({ technicians, canFilterTechnician, onSelectBooking }) {
  const calendarRef = useRef(null)
  const [range, setRange] = useState({ from: null, to: null })
  const [title, setTitle] = useState('')
  const [activeView, setActiveView] = useState('timeGridWeek')
  const [technicianFilter, setTechnicianFilter] = useState(ANY)

  const { events, loading, error, refetch } = useCalendarEvents({
    dateFrom: range.from,
    dateTo: range.to,
    technicianId: technicianFilter === ANY ? undefined : technicianFilter,
    enabled: Boolean(range.from && range.to),
  })

  const handleDatesSet = useCallback((info) => {
    setRange({ from: info.start.toISOString(), to: info.end.toISOString() })
    setTitle(info.view.title)
    setActiveView(info.view.type)
  }, [])

  function api() {
    return calendarRef.current?.getApi() ?? null
  }

  function renderEventContent(arg) {
    const props = arg.event.extendedProps ?? {}
    return (
      <div className="flex min-w-0 items-center gap-1 overflow-hidden px-0.5 py-px">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: arg.event.backgroundColor || '#6366f1' }}
        />
        <span className="truncate text-[11px] font-semibold leading-tight">
          {props.customer_name ?? arg.event.title}
        </span>
        {props.service_type ? (
          <span className="shrink-0 text-[10px] font-medium opacity-80">
            {abbreviateService(props.service_type)}
          </span>
        ) : null}
      </div>
    )
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              aria-label="Previous period"
              onClick={() => api()?.prev()}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => api()?.today()}>
              Today
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              aria-label="Next period"
              onClick={() => api()?.next()}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <p className="ml-2 text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</p>
            {loading ? <Spinner size="sm" className="ml-1" /> : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canFilterTechnician ? (
              <select
                value={technicianFilter}
                onChange={(event) => setTechnicianFilter(event.target.value)}
                className={cn(SELECT_CLASSES, 'h-9 w-[200px]')}
                aria-label="Filter calendar by technician"
              >
                <option value={ANY}>All technicians</option>
                {technicians.map((technician) => (
                  <option key={technician.id} value={technician.id}>
                    {technician.full_name}
                  </option>
                ))}
              </select>
            ) : null}

            <div className="inline-flex rounded-md border border-slate-300 p-0.5 dark:border-slate-700">
              {CALENDAR_VIEWS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => api()?.changeView(item.key)}
                  className={cn(
                    'rounded px-3 py-1.5 text-sm font-medium transition-colors',
                    activeView === item.key
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error.message}
            </span>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        ) : null}

        <div className="qkil-calendar min-h-[600px]">
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            headerToolbar={false}
            height="auto"
            events={events}
            datesSet={handleDatesSet}
            eventContent={renderEventContent}
            eventClick={(info) => {
              info.jsEvent.preventDefault()
              onSelectBooking(info.event.id)
            }}
            nowIndicator
            firstDay={1}
            slotMinTime="06:00:00"
            slotMaxTime="20:00:00"
            allDaySlot={false}
            expandRows
            dayMaxEventRows={4}
            eventTimeFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
            slotLabelFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
            noEventsText="No bookings in this period"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3 dark:border-slate-800">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Legend</span>
          {ALL_BOOKING_STATUSES.map((status) => (
            <BookingStatusBadge key={status} status={status} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export default BookingsPage
