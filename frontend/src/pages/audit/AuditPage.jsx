import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { History, ShieldAlert, ShieldCheck, Building2 } from 'lucide-react'

import * as auditApi from '@/api/audit'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { toApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/utils'

const PAGE_SIZE = 50
const ANY = '__any__'

/** Turns "user.deactivated" into "User deactivated". */
function readable(eventType) {
  const [subject, ...rest] = eventType.split('.')
  const action = rest.join(' ').replace(/_/g, ' ')
  const label = `${subject} ${action}`.replace(/_/g, ' ').trim()
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/**
 * The audit trail: who changed what, and whether the record itself can be
 * trusted.
 *
 * Each entry is hashed together with the one before it, so "Verify" is not
 * decoration - it re-hashes the chain and says where it stops adding up. A
 * trail nobody can check is just a list.
 */
export function AuditPage() {
  const [events, setEvents] = useState([])
  const [eventTypes, setEventTypes] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [typeFilter, setTypeFilter] = useState(ANY)
  const [platformOnly, setPlatformOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [chain, setChain] = useState(null)
  const [verifying, setVerifying] = useState(false)

  useEffect(() => {
    setPage(1)
  }, [typeFilter, platformOnly])

  const params = useMemo(() => {
    const next = { page, page_size: PAGE_SIZE }
    if (typeFilter !== ANY) next.event_type = typeFilter
    if (platformOnly) next.platform_only = true
    return next
  }, [page, typeFilter, platformOnly])

  const paramsKey = JSON.stringify(params)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await auditApi.listAuditEvents(JSON.parse(paramsKey))
      setEvents(data.items)
      setTotal(data.total)
      setEventTypes(data.event_types)
    } catch (err) {
      if (axios.isCancel(err)) return
      setError(toApiError(err, 'Could not load the audit trail'))
      setEvents([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [paramsKey])

  useEffect(() => {
    void load()
  }, [load])

  async function verify() {
    setVerifying(true)
    try {
      setChain(await auditApi.verifyAuditChain())
    } catch (err) {
      setChain({ valid: false, detail: toApiError(err, 'Could not check the trail').message })
    } finally {
      setVerifying(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit trail"
        description="Every change to your team, roles and account, and who made it."
        actions={
          <>
            <RefreshButton onRefresh={load} loading={loading} />
            <Button variant="outline" disabled={verifying} onClick={() => void verify()}>
              {verifying ? <Spinner size="sm" /> : <ShieldCheck className="h-4 w-4" />}
              {verifying ? 'Checking...' : 'Verify the record'}
            </Button>
          </>
        }
      />

      {chain ? (
        <Card
          className={
            chain.valid
              ? 'border-primary/30 bg-primary/5'
              : 'border-destructive/30 bg-destructive/10'
          }
        >
          <CardContent className="flex items-start gap-3 p-4">
            {chain.valid ? (
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            ) : (
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            )}
            <div className="text-sm">
              <p className={chain.valid ? 'font-medium text-primary' : 'font-medium text-destructive'}>
                {chain.valid
                  ? `All ${chain.total_events} entries check out`
                  : 'This record has been altered'}
              </p>
              <p className="text-muted-foreground">{chain.detail}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-full lg:w-[240px]">
              <SelectValue placeholder="Kind of change" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Everything</SelectItem>
              {eventTypes.map((type) => (
                <SelectItem key={type} value={type}>
                  {readable(type)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant={platformOnly ? 'default' : 'outline'}
            onClick={() => setPlatformOnly((on) => !on)}
            className="lg:ml-auto"
          >
            <Building2 className="h-4 w-4" />
            Only QKil staff
          </Button>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        {loading ? (
          <LoadingState message="Loading the audit trail..." />
        ) : error ? (
          <ErrorState title="Could not load the audit trail" message={error.message} onRetry={load} />
        ) : events.length === 0 ? (
          <EmptyState
            icon={History}
            title={platformOnly || typeFilter !== ANY ? 'Nothing matches' : 'Nothing recorded yet'}
            description={
              platformOnly
                ? 'Nobody at QKil has changed anything in your account.'
                : 'Changes to your team, roles and account will appear here.'
            }
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">#</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead className="hidden lg:table-cell">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="text-xs text-muted-foreground">{event.seq}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(event.created_at)}
                    </TableCell>
                    <TableCell className="font-medium text-foreground">
                      {readable(event.event_type)}
                      {event.resource_name ? (
                        <span className="block text-xs font-normal text-muted-foreground">
                          {event.resource_name}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-foreground">{event.actor_name ?? 'System'}</span>
                      {event.actor_is_platform_staff ? (
                        <Badge variant="warning" className="ml-2">
                          QKil staff
                        </Badge>
                      ) : null}
                      {event.actor_email ? (
                        <span className="block text-xs text-muted-foreground">{event.actor_email}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden max-w-xs text-xs text-muted-foreground lg:table-cell">
                      {Object.keys(event.metadata ?? {}).length > 0
                        ? Object.entries(event.metadata)
                            .map(([key, value]) => `${key.replace(/_/g, ' ')}: ${
                              Array.isArray(value) ? `${value.length} item(s)` : value
                            }`)
                            .join(' · ')
                        : '--'}
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
    </div>
  )
}

export default AuditPage
