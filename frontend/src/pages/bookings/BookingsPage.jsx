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
import { EmptyState, ErrorState, PageHeader, Pagination } from '@/components/ui/page'
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
  'flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60'

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
  // A status can arrive in the link, e.g. from Today's "Reports due".
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get('status') || ANY)
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
      toastSuccess('Job deleted', `${pendingDelete.booking_number} was removed.`)
      setPendingDelete(null)
    } catch (err) {
      toastError('Could not delete job', toApiError(err).message)
    } finally {
      setWorking(false)
    }
  }

  async function confirmCancel() {
    if (!pendingCancel) return
    setWorking(true)
    try {
      await updateStatus(pendingCancel.id, BOOKING_STATUS.CANCELLED)
      toastSuccess('Job cancelled', `${pendingCancel.booking_number} is now cancelled.`)
      setPendingCancel(null)
    } catch (err) {
      toastError('Could not cancel job', toApiError(err).message)
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


  return (
    <div className="space-y-6">
      <PageHeader
        title="Jobs"
        description={user?.role === UserRole.TECHNICIAN
        ? 'Your jobs, as a list or on the calendar.'
        : 'Schedule technicians and keep the service calendar up to date.'}
        actions={<div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-input p-0.5">
            <button
              type="button"
              onClick={() => setView('list')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors',
                view === 'list'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted',
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
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted',
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
                Book a job
              </Link>
            </Button>
          ) : null}
        </div>}
      />

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
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search by job number, customer or service..."
                    className="pl-9"
                    aria-label="Search jobs"
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
                  <Label htmlFor="booking-date-from" className="text-xs text-muted-foreground">
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
                  <Label htmlFor="booking-date-to" className="text-xs text-muted-foreground">
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
              <LoadingState message="Loading jobs..." />
            ) : error ? (
              <ErrorState title="Could not load jobs" message={error.message} onRetry={refetch} />
            ) : bookings.length === 0 ? (
              <EmptyState
                icon={CalendarClock}
                title={isFiltered ? 'No jobs match your filters' : 'No jobs booked yet'}
                description={isFiltered
                ? 'Try a different search term or clear the filters.'
                : 'Book your first job to get started.'}
                action={isFiltered ? (
                  <Button variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : canWrite ? (
                  <Button asChild>
                    <Link to="/bookings/new">
                      <Plus className="h-4 w-4" />
                      Book a job
                    </Link>
                  </Button>
                ) : null}
              />
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Job #</TableHead>
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
                          <TableCell className="font-medium text-foreground">
                            {booking.booking_number}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {booking.customer_name ?? '--'}
                          </TableCell>
                          <TableCell className="hidden text-muted-foreground lg:table-cell">
                            {booking.technician_name ?? 'Unassigned'}
                          </TableCell>
                          <TableCell className="hidden text-muted-foreground md:table-cell">
                            {booking.service_type}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatBookingDateTime(booking.scheduled_start)}
                          </TableCell>
                          <TableCell className="hidden text-muted-foreground sm:table-cell">
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
                                        className="text-destructive focus:bg-destructive/10 focus:text-destructive"
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

                <Pagination page={page} totalPages={totalPages} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
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
            <AlertDialogTitle>Delete this job?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `${pendingDelete.booking_number} will be permanently deleted. Only scheduled or cancelled jobs can be removed, and this cannot be undone.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Keep job</AlertDialogCancel>
            <AlertDialogAction
              disabled={working}
              className="bg-destructive hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault()
                void confirmDelete()
              }}
            >
              {working ? 'Deleting...' : 'Delete job'}
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
            <AlertDialogTitle>Cancel this job?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingCancel
                ? `${pendingCancel.booking_number} will be marked as cancelled. Cancelled jobs cannot be reactivated.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Keep job</AlertDialogCancel>
            <AlertDialogAction
              disabled={working}
              className="bg-destructive hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault()
                void confirmCancel()
              }}
            >
              {working ? 'Cancelling...' : 'Cancel job'}
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
            <p className="ml-2 text-sm font-semibold text-foreground">{title}</p>
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

            <div className="inline-flex rounded-md border border-input p-0.5">
              {CALENDAR_VIEWS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => api()?.changeView(item.key)}
                  className={cn(
                    'rounded px-3 py-1.5 text-sm font-medium transition-colors',
                    activeView === item.key
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
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
            eventClassNames={(arg) => (arg.event.extendedProps?.tentative ? ['qkil-tentative'] : [])}
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
            noEventsText="No jobs in this period"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Legend</span>
          {ALL_BOOKING_STATUSES.map((status) => (
            <BookingStatusBadge key={status} status={status} />
          ))}
          <span className="inline-flex items-center rounded-full border border-dashed border-indigo-400 px-2.5 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
            Tentative: repeating visit to confirm
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

export default BookingsPage
