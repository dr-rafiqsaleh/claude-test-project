import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Eye,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Users,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { LoadingState } from '@/components/ui/spinner'
import { toastError, toastSuccess } from '@/components/ui/use-toast'
import { useCustomers } from '@/hooks/useCustomers'
import { useDebounce } from '@/hooks/useDebounce'
import { toApiError } from '@/lib/api'
import { formatAddress } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { UK_COUNTIES } from '@/lib/constants'

const PAGE_SIZE = 20
const ANY = '__any__'

export function CustomersPage() {
  const navigate = useNavigate()
  const canWrite = useAuthStore((state) => state.canWrite())

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
  const [countyFilter, setCountyFilter] = useState(ANY)
  const [page, setPage] = useState(1)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const debouncedSearch = useDebounce(search, 350)

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, statusFilter, countyFilter])

  const params = useMemo(() => {
    const next = {
      page,
      page_size: PAGE_SIZE,
      sort_by: 'created_at',
      sort_desc: true,
    }
    if (debouncedSearch.trim()) next.q = debouncedSearch.trim()
    if (statusFilter === 'active') next.is_active = true
    if (statusFilter === 'archived') next.is_active = false
    if (countyFilter !== ANY) next.county = countyFilter
    return next
  }, [page, debouncedSearch, statusFilter, countyFilter])

  const { customers, total, totalPages, loading, error, remove, restore, refetch } = useCustomers(params)

  async function handleRestore(customer) {
    try {
      await restore(customer.id)
      toastSuccess('Customer restored', `${customer.first_name} ${customer.last_name} is active again.`)
    } catch (err) {
      toastError('Could not restore customer', toApiError(err).message)
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await remove(pendingDelete.id)
      toastSuccess('Customer archived', `${pendingDelete.first_name} ${pendingDelete.last_name} was archived.`)
      setPendingDelete(null)
    } catch (err) {
      toastError('Could not archive customer', toApiError(err).message)
    } finally {
      setDeleting(false)
    }
  }

  const isFiltered = Boolean(debouncedSearch.trim()) || statusFilter !== 'active' || countyFilter !== ANY
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(page * PAGE_SIZE, total)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Customers
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Manage the customer records behind every quote, booking and job.
          </p>
        </div>

        {canWrite ? (
          <Button asChild>
            <Link to="/customers/new">
              <Plus className="h-4 w-4" />
              New customer
            </Link>
          </Button>
        ) : null}
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name, email or phone..."
                className="pl-9"
                aria-label="Search customers"
              />
            </div>

            <div className="flex gap-3">
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value)}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                  <SelectItem value="all">All statuses</SelectItem>
                </SelectContent>
              </Select>

              <Select value={countyFilter} onValueChange={setCountyFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="County" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>All counties</SelectItem>
                  {UK_COUNTIES.map((county) => (
                    <SelectItem key={county} value={county}>
                      {county}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        {loading ? (
          <LoadingState message="Loading customers..." />
        ) : error ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <AlertCircle className="h-10 w-10 text-red-500" />
            <div>
              <p className="font-medium text-slate-900 dark:text-slate-100">Could not load customers</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{error.message}</p>
            </div>
            <Button variant="outline" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        ) : customers.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
              <Users className="h-6 w-6 text-slate-400" />
            </div>
            <div>
              <p className="font-medium text-slate-900 dark:text-slate-100">
                {isFiltered ? 'No customers match your filters' : 'No customers yet'}
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {isFiltered
                  ? 'Try a different search term or clear the filters.'
                  : 'Add your first customer to get started.'}
              </p>
            </div>
            {isFiltered ? (
              <Button
                variant="outline"
                onClick={() => {
                  setSearch('')
                  setStatusFilter('active')
                  setCountyFilter(ANY)
                }}
              >
                Clear filters
              </Button>
            ) : canWrite ? (
              <Button asChild>
                <Link to="/customers/new">
                  <Plus className="h-4 w-4" />
                  New customer
                </Link>
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="hidden md:table-cell">Email</TableHead>
                  <TableHead className="hidden lg:table-cell">Address</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((customer) => (
                  <TableRow
                    key={customer.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/customers/${customer.id}`)}
                  >
                    <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                      {customer.first_name} {customer.last_name}
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400">{customer.phone}</TableCell>
                    <TableCell className="hidden text-slate-600 dark:text-slate-400 md:table-cell">
                      {customer.email ?? '--'}
                    </TableCell>
                    <TableCell className="hidden max-w-[280px] truncate text-slate-600 dark:text-slate-400 lg:table-cell">
                      {formatAddress(customer.address)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={customer.is_active ? 'default' : 'secondary'}>
                        {customer.is_active ? 'Active' : 'Archived'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div onClick={(event) => event.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Row actions">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => navigate(`/customers/${customer.id}`)}>
                              <Eye className="h-4 w-4" />
                              View details
                            </DropdownMenuItem>
                            {canWrite ? (
                              <>
                                <DropdownMenuItem onSelect={() => navigate(`/customers/${customer.id}/edit`)}>
                                  <Pencil className="h-4 w-4" />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                {customer.is_active ? (
                                  <DropdownMenuItem
                                    onSelect={() => setPendingDelete(customer)}
                                    className="text-red-600 focus:bg-red-50 focus:text-red-700 dark:text-red-400 dark:focus:bg-red-950"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                    Archive
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem onSelect={() => void handleRestore(customer)}>
                                    <RotateCcw className="h-4 w-4" />
                                    Restore
                                  </DropdownMenuItem>
                                )}
                              </>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
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
          if (!open && !deleting) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this customer?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `${pendingDelete.first_name} ${pendingDelete.last_name} will be marked inactive and hidden from the active list. Their history is retained and they can be restored later.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
              onClick={(event) => {
                event.preventDefault()
                void confirmDelete()
              }}
            >
              {deleting ? 'Archiving...' : 'Archive customer'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default CustomersPage
