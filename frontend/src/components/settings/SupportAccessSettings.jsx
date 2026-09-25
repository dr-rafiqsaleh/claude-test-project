import { useCallback, useEffect, useState } from 'react'
import { LifeBuoy, Lock, ShieldAlert, Unlock } from 'lucide-react'

import * as supportApi from '@/api/supportAccess'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { LoadingState, Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { toastError, toastSuccess } from '@/components/ui/use-toast'
import { toApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/utils'

const HOUR_CHOICES = [
  { value: '4', label: '4 hours' },
  { value: '24', label: '1 day' },
  { value: '72', label: '3 days' },
  { value: '168', label: '1 week' },
  { value: '336', label: '2 weeks (the longest)' },
]

/**
 * Lets the client decide whether PestBase support can see their records.
 *
 * Closed by default, and every grant runs out on its own - so forgetting to
 * close it is not a way to leave it open forever.
 */
export function SupportAccessSettings() {
  const [state, setState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [hours, setHours] = useState('72')
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setState(await supportApi.getSupportAccess())
    } catch (err) {
      toastError('Could not load support access', toApiError(err).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function open() {
    setBusy(true)
    try {
      const grant = await supportApi.openSupportAccess({
        hours: Number(hours),
        reason: reason.trim() || null,
      })
      toastSuccess(
        'Support access open',
        `PestBase can help until ${formatDateTime(grant.expires_at)}. It closes on its own.`,
      )
      setReason('')
      await load()
    } catch (err) {
      toastError('Could not open support access', toApiError(err).message)
    } finally {
      setBusy(false)
    }
  }

  async function close() {
    setBusy(true)
    try {
      await supportApi.closeSupportAccess()
      toastSuccess('Support access closed', 'PestBase can no longer see your records.')
      await load()
    } catch (err) {
      toastError('Could not close support access', toApiError(err).message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <LoadingState message="Loading support access..." />

  const current = state?.current
  const isOpen = Boolean(state?.open)

  return (
    <Card>
      <CardHeader>
        <CardTitle>PestBase support access</CardTitle>
        <CardDescription>
          Your customers' details are yours. PestBase support cannot see them unless you let them in,
          and any access you give runs out on its own.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div
          className={`flex items-start gap-3 rounded-md border p-4 ${
            isOpen ? 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40' : 'border-border bg-muted/40'
          }`}
        >
          {isOpen ? (
            <Unlock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          ) : (
            <Lock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          )}
          <div className="text-sm">
            <p className="font-medium text-foreground">
              {isOpen ? 'Open to PestBase support' : 'Closed'}
              {current?.break_glass ? (
                <Badge variant="destructive" className="ml-2">
                  Opened by PestBase
                </Badge>
              ) : null}
            </p>
            {isOpen ? (
              <p className="text-muted-foreground">
                Until {formatDateTime(current.expires_at)} ({current.hours_left} hours left)
                {current.reason ? ` · ${current.reason}` : ''}
              </p>
            ) : (
              <p className="text-muted-foreground">
                Nobody at PestBase can open your customers, jobs or invoices.
              </p>
            )}
          </div>
        </div>

        {current?.break_glass && isOpen ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              PestBase opened this themselves rather than being asked. Their reason is on your audit
              trail, and you can close it now.
            </span>
          </div>
        ) : null}

        {isOpen ? (
          <Button variant="outline" disabled={busy} onClick={() => void close()}>
            {busy ? <Spinner size="sm" className="text-current" /> : <Lock className="h-4 w-4" />}
            Close access now
          </Button>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="support-hours">Open for</Label>
              <Select value={hours} onValueChange={setHours}>
                <SelectTrigger id="support-hours" className="w-full sm:w-[240px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOUR_CHOICES.map((choice) => (
                    <SelectItem key={choice.value} value={choice.value}>
                      {choice.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="support-reason">What are they helping with? (optional)</Label>
              <Textarea
                id="support-reason"
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Invoice numbering went wrong after the import."
              />
            </div>

            <Button disabled={busy} onClick={() => void open()}>
              {busy ? (
                <Spinner size="sm" className="text-current" />
              ) : (
                <LifeBuoy className="h-4 w-4" />
              )}
              Let PestBase support in
            </Button>
          </div>
        )}

        {state?.history?.length > 0 ? (
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-sm font-medium text-foreground">Previous access</p>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              {state.history.slice(0, 8).map((grant) => (
                <li key={grant.id} className="flex flex-wrap items-center gap-2">
                  <span>{formatDateTime(grant.created_at)}</span>
                  <span aria-hidden="true">&rarr;</span>
                  <span>{formatDateTime(grant.revoked_at ?? grant.expires_at)}</span>
                  {grant.break_glass ? <Badge variant="destructive">Opened by PestBase</Badge> : null}
                  {grant.revoked_at ? <Badge variant="secondary">Closed early</Badge> : null}
                  {grant.reason ? <span className="text-muted-foreground/80">{grant.reason}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export default SupportAccessSettings
