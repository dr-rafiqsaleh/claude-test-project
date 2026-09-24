import { useMemo, useState } from 'react'
import { AlertCircle, Lock, Pencil, Plus, Shield, Trash2, Users } from 'lucide-react'

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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmptyState, ErrorState } from '@/components/ui/page'
import { LoadingState, Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { toastError, toastSuccess } from '@/components/ui/use-toast'
import { getMe } from '@/api/auth'
import { toApiError } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'

const EMPTY_ROLE = { name: '', description: '', permissions: [] }

/**
 * Roles and what each one may do.
 *
 * The permission list comes from the API, so a permission added on the server
 * shows up here without a frontend change. Admin is read-only: it always holds
 * everything, which is what keeps someone able to manage the team.
 */
export function RolesTab({ roles, permissionGroups, loading, error, refetch, create, update, remove }) {
  const setUser = useAuthStore((state) => state.setUser)
  const myRole = useAuthStore((state) => state.user?.role)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_ROLE)
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const permissionLabels = useMemo(() => {
    const labels = {}
    for (const group of permissionGroups) {
      for (const permission of group.permissions) labels[permission.key] = permission.label
    }
    return labels
  }, [permissionGroups])

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_ROLE)
    setFormError(null)
    setDialogOpen(true)
  }

  function openEdit(role) {
    setEditing(role)
    setForm({
      name: role.name,
      description: role.description ?? '',
      permissions: [...role.permissions],
    })
    setFormError(null)
    setDialogOpen(true)
  }

  function togglePermission(key) {
    setForm((current) => ({
      ...current,
      permissions: current.permissions.includes(key)
        ? current.permissions.filter((permission) => permission !== key)
        : [...current.permissions, key],
    }))
  }

  function toggleGroup(group, allOn) {
    const keys = group.permissions.map((permission) => permission.key)
    setForm((current) => ({
      ...current,
      permissions: allOn
        ? current.permissions.filter((permission) => !keys.includes(permission))
        : [...new Set([...current.permissions, ...keys])],
    }))
  }

  async function save(event) {
    event.preventDefault()
    setFormError(null)

    const name = form.name.trim()
    if (!name) {
      setFormError('A role needs a name.')
      return
    }

    setSaving(true)
    try {
      const payload = {
        name,
        description: form.description.trim() || null,
        permissions: form.permissions,
      }
      if (editing) {
        // Built-in roles keep their names, so only send a name for custom ones.
        await update(editing.key, editing.is_system ? { ...payload, name: undefined } : payload)
        // Editing your own role changes what this session may do, so reload it
        // rather than leaving the menus and buttons showing the old permissions.
        if (editing.key === myRole) setUser(await getMe())
        toastSuccess('Role saved', `${name} was updated.`)
      } else {
        await create(payload)
        toastSuccess('Role created', `${name} is ready to give out.`)
      }
      setDialogOpen(false)
      setEditing(null)
    } catch (err) {
      setFormError(toApiError(err, 'Could not save this role').message)
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await remove(pendingDelete.key)
      toastSuccess('Role deleted', `${pendingDelete.name} is gone.`)
      setPendingDelete(null)
    } catch (err) {
      toastError('Could not delete this role', toApiError(err).message)
    } finally {
      setDeleting(false)
    }
  }

  if (loading) return <LoadingState message="Loading roles..." />
  if (error) return <ErrorState title="Could not load roles" message={error.message} onRetry={refetch} />

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          A role is a named set of permissions. Change one and everyone with that role is affected
          straight away.
        </p>
        <Button onClick={openCreate} className="shrink-0">
          <Plus className="h-4 w-4" />
          New role
        </Button>
      </div>

      {roles.length === 0 ? (
        <Card>
          <EmptyState
            icon={Shield}
            title="No roles yet"
            description="Create a role and choose what it may do."
            action={<Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              New role
            </Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {roles.map((role) => (
            <Card key={role.key}>
              <CardContent className="space-y-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium text-foreground">{role.name}</h3>
                      {role.is_system ? <Badge variant="secondary">Built-in</Badge> : null}
                      {!role.editable ? (
                        <Badge variant="outline" className="gap-1">
                          <Lock className="h-3 w-3" />
                          Locked
                        </Badge>
                      ) : null}
                    </div>
                    {role.description ? (
                      <p className="mt-1 text-sm text-muted-foreground">{role.description}</p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={!role.editable}
                      onClick={() => openEdit(role)}
                      aria-label={`Edit ${role.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={role.is_system || role.user_count > 0}
                      onClick={() => setPendingDelete(role)}
                      aria-label={`Delete ${role.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  {role.user_count} {role.user_count === 1 ? 'person' : 'people'}
                  <span aria-hidden="true">·</span>
                  {role.permissions.length} permission{role.permissions.length === 1 ? '' : 's'}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {role.permissions.slice(0, 6).map((permission) => (
                    <span
                      key={permission}
                      className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {permissionLabels[permission] ?? permission}
                    </span>
                  ))}
                  {role.permissions.length > 6 ? (
                    <span className="px-1 py-0.5 text-xs text-muted-foreground">
                      +{role.permissions.length - 6} more
                    </span>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (saving) return
          setDialogOpen(open)
          if (!open) setEditing(null)
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : 'New role'}</DialogTitle>
            <DialogDescription>
              Tick everything this role may do. Anything left unticked is refused by the API, not
              just hidden.
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

          <form onSubmit={save} className="space-y-5" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="role-name">Name *</Label>
              <Input
                id="role-name"
                value={form.name}
                maxLength={60}
                disabled={Boolean(editing?.is_system)}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Senior Technician"
              />
              {editing?.is_system ? (
                <p className="text-xs text-muted-foreground">
                  Built-in roles keep their names. Create a new role if you need a different one.
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="role-description">Description</Label>
              <Textarea
                id="role-description"
                value={form.description}
                maxLength={300}
                rows={2}
                onChange={(event) =>
                  setForm((current) => ({ ...current, description: event.target.value }))
                }
                placeholder="What this role is for, in a line."
              />
            </div>

            <div className="space-y-4">
              <Label>Permissions</Label>
              {permissionGroups.map((group) => {
                const keys = group.permissions.map((permission) => permission.key)
                const allOn = keys.every((key) => form.permissions.includes(key))

                return (
                  <div key={group.group} className="rounded-md border border-border p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground">{group.group}</span>
                      <button
                        type="button"
                        className="text-xs text-primary hover:underline"
                        onClick={() => toggleGroup(group, allOn)}
                      >
                        {allOn ? 'Clear all' : 'Select all'}
                      </button>
                    </div>

                    <div className="space-y-2">
                      {group.permissions.map((permission) => (
                        <label
                          key={permission.key}
                          className="flex cursor-pointer items-start gap-2.5 text-sm"
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
                            checked={form.permissions.includes(permission.key)}
                            onChange={() => togglePermission(permission.key)}
                          />
                          <span>
                            <span className="font-medium text-foreground">{permission.label}</span>
                            <span className="block text-xs text-muted-foreground">
                              {permission.description}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
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
                  'Save role'
                ) : (
                  'Create role'
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
            <AlertDialogTitle>Delete this role?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `${pendingDelete.name} will be removed. Nobody has this role, so no one loses access.`
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
              {deleting ? 'Deleting...' : 'Delete role'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default RolesTab
