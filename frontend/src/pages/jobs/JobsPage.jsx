import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  Eye,
  FileText,
  MoreHorizontal,
  Pencil,
  Search,
  Trash2,
} from 'lucide-react'

import { downloadJobReport } from '@/api/jobs'
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
import { JobStatusBadge } from '@/components/jobs/JobStatusBadge'
import { RiskLevelBadge } from '@/components/jobs/RiskLevelBadge'
import { SELECT_CLASSES } from '@/components/jobs/JobFormControls'
import { useJobs } from '@/hooks/useJobs'
import { useTechnicians } from '@/hooks/useBookings'
import { useDebounce } from '@/hooks/useDebounce'
import { toApiError } from '@/lib/api'
import { cn, formatBookingDateTime } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import {
  ALL_JOB_STATUSES,
  DELETABLE_JOB_STATUSES,
  EDITABLE_JOB_STATUSES,
  JOB_STATUS,
  JOB_STATUS_LABELS,
  UserRole,
} from '@/lib/constants'

const PAGE_SIZE = 20
const ANY = '__any__'

const STATUS_TABS = [{ key: ANY, label: 'All' }].concat(
  ALL_JOB_STATUSES.map((status) => ({ key: status, label: JOB_STATUS_LABELS[status] })),
)

export function JobsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const user = useAuthStore((state) => state.user)
  const canWrite = useAuthStore((state) => state.canWrite())
  const isAdmin = useAuthStore((state) => state.isAdmin())

  const customerId = searchParams.get('customer_id') ?? ''

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState(ANY)
  const [technicianFilter, setTechnicianFilter] = useState(ANY)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [working, setWorking] = useState(false)
  const [downloadingId, setDownloadingId] = useState(null)

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

  const { jobs, total, totalPages, loading, error, remove, refetch } = useJobs(listParams)

  async function confirmDelete() {
    if (!pendingDelete) return
    setWorking(true)
    try {
      await remove(pendingDelete.id)
      toastSuccess('Job deleted', `${pendingDelete.job_number} was removed.`)
      setPendingDelete(null)
    } catch (err) {
      toastError('Could not delete job', toApiError(err).message)
    } finally {
      setWorking(false)
    }
  }

  async function handleDownload(job) {
    setDownloadingId(job.id)
    try {
      await downloadJobReport(job.id, job.job_number)
      toastSuccess('Report downloaded', `${job.job_number} inspection report saved.`)
    } catch (err) {
      toastError('Could not download the report', toApiError(err).message)
    } finally {
      setDownloadingId(null)
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
            Jobs
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {user?.role === UserRole.TECHNICIAN
              ? 'Your on-site work and inspection reports.'
              : 'Track on-site work, inspection reports and sign-offs.'}
          </p>
        </div>

      </div>

      <div className="flex flex-wrap gap-1 rounded-md border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setStatusFilter(tab.key)}
            className={cn(
              'rounded px-3 py-1.5 text-sm font-medium transition-colors',
              statusFilter === tab.key
                ? 'bg-emerald-600 text-white'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by job number, customer or service..."
                className="pl-9"
                aria-label="Search jobs"
              />
            </div>

            {canWrite ? (
              <select
                value={technicianFilter}
                onChange={(event) => setTechnicianFilter(event.target.value)}
                className={cn(SELECT_CLASSES, 'lg:w-[220px]')}
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
              <Label htmlFor="job-date-from" className="text-xs text-slate-500">
                From
              </Label>
              <Input
                id="job-date-from"
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="sm:w-[170px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="job-date-to" className="text-xs text-slate-500">
                To
              </Label>
              <Input
                id="job-date-to"
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
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <AlertCircle className="h-10 w-10 text-red-500" />
            <div>
              <p className="font-medium text-slate-900 dark:text-slate-100">Could not load jobs</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{error.message}</p>
            </div>
            <Button variant="outline" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
              <ClipboardList className="h-6 w-6 text-slate-400" />
            </div>
            <div>
              <p className="font-medium text-slate-900 dark:text-slate-100">
                {isFiltered ? 'No jobs match your filters' : 'No jobs yet'}
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {isFiltered
                  ? 'Try a different search term or clear the filters.'
                  : "A visit's report opens as soon as the visit is started from its booking."}
              </p>
            </div>
            {isFiltered ? (
              <Button variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="hidden lg:table-cell">Technician</TableHead>
                  <TableHead className="hidden md:table-cell">Service type</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Risk</TableHead>
                  <TableHead className="hidden sm:table-cell">Report</TableHead>
                  <TableHead className="w-12 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => {
                  const editable = EDITABLE_JOB_STATUSES.includes(job.status)
                  const deletable = DELETABLE_JOB_STATUSES.includes(job.status)
                  const completed = job.status === JOB_STATUS.COMPLETED
                  return (
                    <TableRow
                      key={job.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/jobs/${job.id}`)}
                    >
                      <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                        {job.job_number}
                      </TableCell>
                      <TableCell className="text-slate-600 dark:text-slate-400">
                        {job.customer_name ?? '--'}
                      </TableCell>
                      <TableCell className="hidden text-slate-600 dark:text-slate-400 lg:table-cell">
                        {job.technician_name ?? 'Unassigned'}
                      </TableCell>
                      <TableCell className="hidden text-slate-600 dark:text-slate-400 md:table-cell">
                        {job.service_type}
                      </TableCell>
                      <TableCell className="text-slate-600 dark:text-slate-400">
                        {formatBookingDateTime(job.scheduled_start)}
                      </TableCell>
                      <TableCell>
                        <JobStatusBadge status={job.status} />
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {job.overall_risk_level ? (
                          <RiskLevelBadge level={job.overall_risk_level} />
                        ) : (
                          <span className="text-sm text-slate-400">--</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {job.report_generated ? (
                          <Badge variant="default">Generated</Badge>
                        ) : completed ? (
                          <Badge variant="secondary">Ready</Badge>
                        ) : (
                          <span className="text-sm text-slate-400">--</span>
                        )}
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
                                {downloadingId === job.id ? (
                                  <Spinner size="sm" />
                                ) : (
                                  <MoreHorizontal className="h-4 w-4" />
                                )}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => navigate(`/jobs/${job.id}`)}>
                                <Eye className="h-4 w-4" />
                                View details
                              </DropdownMenuItem>
                              {editable ? (
                                <DropdownMenuItem
                                  onSelect={() => navigate(`/jobs/${job.id}/report`)}
                                >
                                  <Pencil className="h-4 w-4" />
                                  Edit report
                                </DropdownMenuItem>
                              ) : null}
                              {completed ? (
                                <DropdownMenuItem onSelect={() => void handleDownload(job)}>
                                  <Download className="h-4 w-4" />
                                  Download report
                                </DropdownMenuItem>
                              ) : null}
                              {job.booking_id ? (
                                <DropdownMenuItem
                                  onSelect={() => navigate(`/bookings/${job.booking_id}`)}
                                >
                                  <FileText className="h-4 w-4" />
                                  View booking
                                </DropdownMenuItem>
                              ) : null}
                              {isAdmin && deletable ? (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onSelect={() => setPendingDelete(job)}
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
                ? `${pendingDelete.job_number} and its photos will be permanently deleted. Only pending jobs can be removed, and this cannot be undone.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Keep job</AlertDialogCancel>
            <AlertDialogAction
              disabled={working}
              className="bg-red-600 hover:bg-red-700"
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
    </div>
  )
}

export default JobsPage
