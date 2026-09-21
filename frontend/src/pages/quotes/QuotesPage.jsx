import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Download,
  Eye,
  FileText,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { LoadingState } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toastError, toastSuccess } from '@/components/ui/use-toast'
import { downloadQuotePdf } from '@/api/quotes'
import { useDebounce } from '@/hooks/useDebounce'
import { useQuotes } from '@/hooks/useQuotes'
import { toApiError } from '@/lib/api'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import {
  ALL_QUOTE_STATUSES,
  QUOTE_STATUS_BADGE,
  QUOTE_STATUS_LABELS,
  QuoteStatus,
} from '@/lib/constants'

const PAGE_SIZE = 20
const ANY = '__any__'

export function QuotesPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const canWrite = useAuthStore((state) => state.canWrite())
  const isAdmin = useAuthStore((state) => state.isAdmin())

  const customerId = searchParams.get('customer_id') ?? ''

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState(ANY)
  const [page, setPage] = useState(1)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [downloadingId, setDownloadingId] = useState(null)

  const debouncedSearch = useDebounce(search, 350)

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, statusFilter, customerId])

  const params = useMemo(() => {
    const next = { page, page_size: PAGE_SIZE }
    if (debouncedSearch.trim()) next.q = debouncedSearch.trim()
    if (statusFilter !== ANY) next.status = statusFilter
    if (customerId) next.customer_id = customerId
    return next
  }, [page, debouncedSearch, statusFilter, customerId])

  const { quotes, total, totalPages, loading, error, remove, refetch } = useQuotes(params)

  async function handleDownload(quote) {
    setDownloadingId(quote.id)
    try {
      await downloadQuotePdf(quote.id, quote.quote_number)
    } catch (err) {
      toastError('Could not download PDF', toApiError(err).message)
    } finally {
      setDownloadingId(null)
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await remove(pendingDelete.id)
      toastSuccess('Quote deleted', `${pendingDelete.quote_number} was removed.`)
      setPendingDelete(null)
    } catch (err) {
      toastError('Could not delete quote', toApiError(err).message)
    } finally {
      setDeleting(false)
    }
  }

  const isFiltered = Boolean(debouncedSearch.trim()) || statusFilter !== ANY || Boolean(customerId)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quotes"
        description="Build, send and track quotes for your customers."
        actions={canWrite ? (
          <Button asChild>
            <Link to="/quotes/new">
              <Plus className="h-4 w-4" />
              New quote
            </Link>
          </Button>
        ) : null}
      />

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by quote number or customer name..."
                className="pl-9"
                aria-label="Search quotes"
              />
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[170px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All statuses</SelectItem>
                {ALL_QUOTE_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {QUOTE_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {customerId ? (
            <div className="mt-3 flex items-center gap-2">
              <Badge variant="info">Filtered to one customer</Badge>
              <Button variant="link" size="sm" className="h-auto p-0" onClick={() => navigate('/quotes')}>
                Show all quotes
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        {loading ? (
          <LoadingState message="Loading quotes..." />
        ) : error ? (
          <ErrorState title="Could not load quotes" message={error.message} onRetry={refetch} />
        ) : quotes.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={isFiltered ? 'No quotes match your filters' : 'No quotes yet'}
            description={isFiltered
            ? 'Try a different search term or clear the filters.'
            : 'Create your first quote to get started.'}
            action={isFiltered ? (
              <Button
                variant="outline"
                onClick={() => {
                  setSearch('')
                  setStatusFilter(ANY)
                  navigate('/quotes')
                }}
              >
                Clear filters
              </Button>
            ) : canWrite ? (
              <Button asChild>
                <Link to="/quotes/new">
                  <Plus className="h-4 w-4" />
                  New quote
                </Link>
              </Button>
            ) : null}
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quote #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Items</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="hidden lg:table-cell">Valid until</TableHead>
                  <TableHead className="hidden lg:table-cell">Created</TableHead>
                  <TableHead className="w-12 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotes.map((quote) => {
                  const isDraft = quote.status === QuoteStatus.DRAFT
                  return (
                    <TableRow
                      key={quote.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/quotes/${quote.id}`)}
                    >
                      <TableCell className="font-medium text-foreground">
                        {quote.quote_number}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {quote.customer_name ?? '--'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={QUOTE_STATUS_BADGE[quote.status]}>
                          {QUOTE_STATUS_LABELS[quote.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        {quote.items.length}
                      </TableCell>
                      <TableCell className="text-right font-medium text-foreground">
                        {formatCurrency(quote.total)}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">
                        {formatDate(quote.valid_until)}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">
                        {formatDate(quote.created_at)}
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
                              <DropdownMenuItem onSelect={() => navigate(`/quotes/${quote.id}`)}>
                                <Eye className="h-4 w-4" />
                                View details
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={downloadingId === quote.id}
                                onSelect={(event) => {
                                  event.preventDefault()
                                  void handleDownload(quote)
                                }}
                              >
                                <Download className="h-4 w-4" />
                                {downloadingId === quote.id ? 'Preparing...' : 'Download PDF'}
                              </DropdownMenuItem>
                              {canWrite && isDraft ? (
                                <DropdownMenuItem onSelect={() => navigate(`/quotes/${quote.id}/edit`)}>
                                  <Pencil className="h-4 w-4" />
                                  Edit
                                </DropdownMenuItem>
                              ) : null}
                              {isAdmin && isDraft ? (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onSelect={() => setPendingDelete(quote)}
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

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this quote?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `${pendingDelete.quote_number} will be permanently deleted. Only draft quotes can be removed, and this cannot be undone.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-destructive hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault()
                void confirmDelete()
              }}
            >
              {deleting ? 'Deleting...' : 'Delete quote'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default QuotesPage
