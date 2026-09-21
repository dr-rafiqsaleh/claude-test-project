import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  AlertCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  UserCog,
  UserX,
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
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
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
import { toastError, toastSuccess } from '@/components/ui/use-toast'
import { useDebounce } from '@/hooks/useDebounce'
import { useUsers } from '@/hooks/useUsers'
import { toApiError } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { ALL_ROLES, ROLE_LABELS, UserRole } from '@/lib/constants'

const PAGE_SIZE = 20
const ANY = '__any__'

const ROLE_BADGE = {
  [UserRole.ADMIN]: 'default',
  [UserRole.OFFICE_STAFF]: 'info',
  [UserRole.TECHNICIAN]: 'secondary',
}

const passwordSchema = z
  .string()
  .min(8, 'At least 8 characters')
  .regex(/[A-Z]/, 'Must include an uppercase letter')
  .regex(/[a-z]/, 'Must include a lowercase letter')
  .regex(/\d/, 'Must include a number')

const PASSWORD_HINT =
  'At least 8 characters with an uppercase letter, a lowercase letter and a number'

/**
 * One schema shape for both modes. When editing, an empty password means
 * "keep the current one"; when creating, a password is required.
 */
function buildUserSchema(isEdit) {
  return z.object({
    full_name: z.string().trim().min(1, 'Full name is required').max(120),
    job_title: z.string().trim().max(80),
    email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
    password: z.string().refine(
      (value) => (isEdit && value === '') || passwordSchema.safeParse(value).success,
      { message: isEdit ? PASSWORD_HINT : `Password is required. ${PASSWORD_HINT}.` },
    ),
    role: z.nativeEnum(UserRole),
    is_active: z.boolean(),
  })
}

const EMPTY_USER = {
  full_name: '',
  job_title: '',
  email: '',
  password: '',
  role: UserRole.TECHNICIAN,
  is_active: true,
}

export function UsersPage() {
  const currentUser = useAuthStore((state) => state.user)

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState(ANY)
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [formError, setFormError] = useState(null)
  const [pendingDeactivate, setPendingDeactivate] = useState(null)
  const [deactivating, setDeactivating] = useState(false)

  const debouncedSearch = useDebounce(search, 350)

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, roleFilter, statusFilter])

  const params = useMemo(() => {
    const next = { page, page_size: PAGE_SIZE }
    if (debouncedSearch.trim()) next.q = debouncedSearch.trim()
    if (roleFilter !== ANY) next.role = roleFilter
    if (statusFilter === 'active') next.is_active = true
    if (statusFilter === 'inactive') next.is_active = false
    return next
  }, [page, debouncedSearch, roleFilter, statusFilter])

  const { users, total, totalPages, loading, error, create, update, remove, refetch } = useUsers(params)

  const isEdit = editing !== null
  const schema = useMemo(() => buildUserSchema(isEdit), [isEdit])

  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: EMPTY_USER,
    mode: 'onBlur',
  })

  function openCreate() {
    setEditing(null)
    setFormError(null)
    form.reset(EMPTY_USER)
    setDialogOpen(true)
  }

  function openEdit(user) {
    setEditing(user)
    setFormError(null)
    form.reset({
      full_name: user.full_name,
      job_title: user.job_title ?? '',
      email: user.email,
      password: '',
      role: user.role,
      is_active: user.is_active,
    })
    setDialogOpen(true)
  }

  async function onSubmit(values) {
    setFormError(null)
    try {
      if (editing) {
        await update(editing.id, {
          full_name: values.full_name,
          job_title: values.job_title || null,
          email: values.email,
          role: values.role,
          is_active: values.is_active,
          ...(values.password ? { password: values.password } : {}),
        })
        toastSuccess('User updated', `${values.full_name} was saved.`)
      } else {
        await create({
          full_name: values.full_name,
          job_title: values.job_title || null,
          email: values.email,
          password: values.password,
          role: values.role,
          is_active: values.is_active,
        })
        toastSuccess('User created', `${values.full_name} can now sign in.`)
      }
      setDialogOpen(false)
      setEditing(null)
    } catch (err) {
      const apiError = toApiError(err, 'Could not save this user')
      setFormError(apiError.message)
    }
  }

  async function confirmDeactivate() {
    if (!pendingDeactivate) return
    setDeactivating(true)
    try {
      await remove(pendingDeactivate.id)
      toastSuccess('User deactivated', `${pendingDeactivate.full_name} can no longer sign in.`)
      setPendingDeactivate(null)
    } catch (err) {
      toastError('Could not deactivate user', toApiError(err).message)
    } finally {
      setDeactivating(false)
    }
  }

  const submitting = form.formState.isSubmitting
  const isFiltered = Boolean(debouncedSearch.trim()) || roleFilter !== ANY || statusFilter !== 'all'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Manage staff accounts and what each person can access."
        actions={<Button onClick={openCreate}>
          <Plus className="h-4 w-4" />
          New user
        </Button>}
      />

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name or email..."
                className="pl-9"
                aria-label="Search users"
              />
            </div>

            <div className="flex gap-3">
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="w-[170px]">
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>All roles</SelectItem>
                  {ALL_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={statusFilter}
                onValueChange={(value) => setStatusFilter(value)}
              >
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        {loading ? (
          <LoadingState message="Loading users..." />
        ) : error ? (
          <ErrorState title="Could not load users" message={error.message} onRetry={refetch} />
        ) : users.length === 0 ? (
          <EmptyState
            icon={UserCog}
            title={isFiltered ? 'No users match your filters' : 'No users yet'}
            description={isFiltered ? 'Try a different search or clear the filters.' : 'Create the first staff account.'}
            action={isFiltered ? (
              <Button
                variant="outline"
                onClick={() => {
                  setSearch('')
                  setRoleFilter(ANY)
                  setStatusFilter('all')
                }}
              >
                Clear filters
              </Button>
            ) : (
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" />
                New user
              </Button>
            )}
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Created</TableHead>
                  <TableHead className="w-12 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => {
                  const isSelf = currentUser?.id === user.id
                  return (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium text-foreground">
                        {user.full_name}
                        {isSelf ? (
                          <span className="ml-2 text-xs font-normal text-muted-foreground/70">(you)</span>
                        ) : null}
                        {user.job_title ? (
                          <span className="block text-xs font-normal text-muted-foreground">
                            {user.job_title}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{user.email}</TableCell>
                      <TableCell>
                        <Badge variant={ROLE_BADGE[user.role]}>{ROLE_LABELS[user.role]}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={user.is_active ? 'default' : 'secondary'}>
                          {user.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        {formatDate(user.created_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Row actions">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => openEdit(user)}>
                              <Pencil className="h-4 w-4" />
                              Edit user
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              disabled={isSelf || !user.is_active}
                              onSelect={() => setPendingDeactivate(user)}
                              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                            >
                              <UserX className="h-4 w-4" />
                              Deactivate
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
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

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!submitting) {
            setDialogOpen(open)
            if (!open) setEditing(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isEdit ? 'Edit user' : 'New user'}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? 'Update this account. Leave the password blank to keep the current one.'
                : 'Create a staff account and choose what they can access.'}
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

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <FormField
                control={form.control}
                name="full_name"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Full name *</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Olivia Office" hasError={Boolean(fieldState.error)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="job_title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Job title</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Senior Technician" />
                    </FormControl>
                    <FormDescription>Printed as their position on inspection reports.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Email *</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="email"
                        placeholder="olivia@qkil.com"
                        hasError={Boolean(fieldState.error)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>{isEdit ? 'New password' : 'Password *'}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="password"
                        autoComplete="new-password"
                        placeholder="••••••••"
                        hasError={Boolean(fieldState.error)}
                      />
                    </FormControl>
                    <FormDescription>
                      {isEdit
                        ? 'Leave blank to keep the existing password.'
                        : 'Minimum 8 characters with an uppercase letter, a lowercase letter and a number.'}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="role"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Role *</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger hasError={Boolean(fieldState.error)}>
                          <SelectValue placeholder="Select a role" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {ALL_ROLES.map((role) => (
                          <SelectItem key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="is_active"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select
                      value={field.value ? 'active' : 'inactive'}
                      onValueChange={(value) => field.onChange(value === 'active')}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={submitting}
                  onClick={() => {
                    setDialogOpen(false)
                    setEditing(null)
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? (
                    <>
                      <Spinner size="sm" className="text-current" />
                      Saving...
                    </>
                  ) : isEdit ? (
                    'Save changes'
                  ) : (
                    'Create user'
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDeactivate !== null}
        onOpenChange={(open) => {
          if (!open && !deactivating) setPendingDeactivate(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate this user?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeactivate
                ? `${pendingDeactivate.full_name} will immediately lose access to QKil. The account is kept so their history stays intact, and you can re-activate it later.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deactivating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deactivating}
              className="bg-destructive hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault()
                void confirmDeactivate()
              }}
            >
              {deactivating ? 'Deactivating...' : 'Deactivate user'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default UsersPage
