import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Building2,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmptyState, ErrorState, PageHeader, Pagination, RefreshButton } from '@/components/ui/page'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { LoadingState, Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { toastError, toastSuccess } from '@/components/ui/use-toast'
import { useClients } from '@/hooks/useClients'
import { useDebounce } from '@/hooks/useDebounce'
import { toApiError } from '@/lib/api'
import { formatDate } from '@/lib/utils'

const PAGE_SIZE = 20
const ANY = '__any__'

const STATUS_LABELS = { active: 'Active', suspended: 'Suspended', closed: 'Closed' }
const STATUS_BADGE = { active: 'default', suspended: 'warning', closed: 'secondary' }

const EMPTY_CLIENT = { name: '', contact_email: '', contact_phone: '', notes: '' }

/**
 * The client companies using QKil. Platform staff only.
 *
 * Suspending is the everyday lever: it stops everyone at that company signing
 * in without touching a single record. Deleting is only for a client that never
 * got going, and the API refuses it once anyone has been added.
 */
export function ClientsPage() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState(ANY)
  const [page, setPage] = useState(1)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_CLIENT)
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const debouncedSearch = useDebounce(search, 350)

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, statusFilter])

  const params = useMemo(() => {
    const next = { page, page_size: PAGE_SIZE }
    if (debouncedSearch.trim()) next.q = debouncedSearch.trim()
    if (statusFilter !== ANY) next.status = statusFilter
    return next
  }, [page, debouncedSearch, statusFilter])

  const { clients, total, totalPages, loading, error, refetch, create, update, remove } =
    useClients(params)

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_CLIENT)
    setFormError(null)
    setDialogOpen(true)
  }

  function openEdit(client) {
    setEditing(client)
    setForm({
      name: client.name,
      contact_email: client.contact_email ?? '',
      contact_phone: client.contact_phone ?? '',
      notes: client.notes ?? '',
    })
    setFormError(null)
    setDialogOpen(true)
  }

  async function save(event) {
    event.preventDefault()
    setFormError(null)

    const name = form.name.trim()
    if (!name) {
      setFormError('A client needs a name.')
      return
    }

    setSaving(true)
    try {
      const payload = {
        name,
        contact_email: form.contact_email.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
        notes: form.notes.trim() || null,
      }
      if (editing) {
        await update(editing.id, payload)
        toastSuccess('Client saved', `${name} was updated.`)
      } else {
        await create(payload)
        toastSuccess('Client added', `${name} can now have its team set up.`)
      }
      setDialogOpen(false)
      setEditing(null)
    } catch (err) {
      setFormError(toApiError(err, 'Could not save this client').message)
    } finally {
      setSaving(false)
    }
  }

  async function changeStatus(client, status) {
    try {
      await update(client.id, { status })
      toastSuccess(
        status === 'active' ? 'Client resumed' : 'Client suspended',
        status === 'active'
          ? `${client.name} can sign in again.`
          : `Nobody at ${client.name} can sign in. Nothing was deleted.`,
      )
    } catch (err) {
      toastError('Could not change this client', toApiError(err).message)
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await remove(pendingDelete.id)
      toastSuccess('Client deleted', `${pendingDelete.name} is gone.`)
      setPendingDelete(null)
    } catch (err) {
      toastError('Could not delete this client', toApiError(err).message)
    } finally {
      setDeleting(false)
    }
  }

  const isFiltered = Boolean(debouncedSearch.trim()) || statusFilter !== ANY

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        description="The companies using QKil. Each one's customers, jobs and invoices are theirs alone."
        actions={
          <>
            <RefreshButton onRefresh={refetch} loading={loading} />
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              New client
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name, handle or contact email..."
                className="pl-9"
                aria-label="Search clients"
              />
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[170px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All statuses</SelectItem>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        {loading ? (
          <LoadingState message="Loading clients..." />
        ) : error ? (
          <ErrorState title="Could not load clients" message={error.message} onRetry={refetch} />
        ) : clients.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={isFiltered ? 'No clients match your filters' : 'No clients yet'}
            description={
              isFiltered
                ? 'Try a different search or clear the filters.'
                : 'Add the first company to use QKil.'
            }
            action={
              isFiltered ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch('')
                    setStatusFilter(ANY)
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button onClick={openCreate}>
                  <Plus className="h-4 w-4" />
                  New client
                </Button>
              )
            }
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>People</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Added</TableHead>
                  <TableHead className="w-12 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((client) => (
                  <TableRow key={client.id}>
                    <TableCell className="font-medium text-foreground">
                      {client.name}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {client.slug}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {client.contact_email || '--'}
                      {client.contact_phone ? (
                        <span className="block text-xs">{client.contact_phone}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5" />
                        {client.user_count}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[client.status] ?? 'secondary'}>
                        {STATUS_LABELS[client.status] ?? client.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {formatDate(client.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Row actions">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => openEdit(client)}>
                            <Pencil className="h-4 w-4" />
                            Edit details
                          </DropdownMenuItem>
                          {client.status === 'active' ? (
                            <DropdownMenuItem onSelect={() => void changeStatus(client, 'suspended')}>
                              <Pause className="h-4 w-4" />
                              Suspend access
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onSelect={() => void changeStatus(client, 'active')}>
                              <Play className="h-4 w-4" />
                              Resume access
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            disabled={client.user_count > 0}
                            onSelect={() => setPendingDelete(client)}
                            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete client
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (saving) return
          setDialogOpen(open)
          if (!open) setEditing(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : 'New client'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'The company details QKil holds about this client.'
                : 'Add a company. It starts with the three built-in roles, ready for its first admin.'}
            </DialogDescription>
          </DialogHeader>

          {formError ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{formError}</span>
            </div>
          ) : null}

          <form onSubmit={save} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="client-name">Company name *</Label>
              <Input
                id="client-name"
                value={form.name}
                maxLength={120}
                onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))}
                placeholder="Acme Pest Control"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="client-email">Contact email</Label>
              <Input
                id="client-email"
                type="email"
                value={form.contact_email}
                onChange={(event) => setForm((c) => ({ ...c, contact_email: event.target.value }))}
                placeholder="accounts@acmepest.co.uk"
              />
              <p className="text-xs text-muted-foreground">
                Who QKil contacts about the account, not their own customers.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="client-phone">Contact phone</Label>
              <Input
                id="client-phone"
                value={form.contact_phone}
                maxLength={40}
                onChange={(event) => setForm((c) => ({ ...c, contact_phone: event.target.value }))}
                placeholder="0151 496 0000"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="client-notes">Notes</Label>
              <Textarea
                id="client-notes"
                value={form.notes}
                maxLength={1000}
                rows={3}
                onChange={(event) => setForm((c) => ({ ...c, notes: event.target.value }))}
                placeholder="Anything worth remembering about this account."
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => {
                  setDialogOpen(false)
                  setEditing(null)
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <>
                    <Spinner size="sm" className="text-current" />
                    Saving...
                  </>
                ) : editing ? (
                  'Save client'
                ) : (
                  'Add client'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this client?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `${pendingDelete.name} will be removed. Nobody has been added to it, so there is nothing to lose. For a client that has been trading, suspend it instead so its records stay.`
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
              {deleting ? 'Deleting...' : 'Delete client'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default ClientsPage
