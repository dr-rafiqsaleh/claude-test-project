import { useCallback, useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { AlertTriangle, Building2, CheckCircle2, Inbox, Mail, Phone, RotateCcw, Send } from 'lucide-react'

import { listEnquiries, resendEnquiry, setEnquiryHandled } from '@/api/enquiries'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState, ErrorState, PageHeader, Pagination, RefreshButton } from '@/components/ui/page'
import { LoadingState, Spinner } from '@/components/ui/spinner'
import { toastError, toastSuccess } from '@/components/ui/use-toast'
import { toApiError } from '@/lib/api'
import { cn, formatDateTime } from '@/lib/utils'

const PAGE_SIZE = 20

const FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'handled', label: 'Handled' },
  { value: 'all', label: 'All' },
]

function EnquiryCard({ enquiry, busy, onHandled, onResend }) {
  const handled = Boolean(enquiry.handled_at)

  return (
    <Card className={cn(handled && 'opacity-75')}>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold text-foreground">{enquiry.name}</h2>
              <Badge variant="secondary">{enquiry.topic_label}</Badge>
              {handled ? <Badge>Handled</Badge> : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{formatDateTime(enquiry.created_at)}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            {!enquiry.emailed ? (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => onResend(enquiry)}>
                <Send className="h-4 w-4" />
                Email again
              </Button>
            ) : null}
            <Button
              variant={handled ? 'outline' : 'default'}
              size="sm"
              disabled={busy}
              onClick={() => onHandled(enquiry, !handled)}
            >
              {busy ? <Spinner size="sm" /> : handled ? <RotateCcw className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              {handled ? 'Open again' : 'Mark handled'}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
          <a href={`mailto:${enquiry.email}`} className="inline-flex items-center gap-1.5 text-primary hover:underline">
            <Mail className="h-4 w-4" aria-hidden="true" />
            {enquiry.email}
          </a>
          {enquiry.phone ? (
            <a
              href={`tel:${enquiry.phone.replace(/\s/g, '')}`}
              className="inline-flex items-center gap-1.5 text-primary hover:underline"
            >
              <Phone className="h-4 w-4" aria-hidden="true" />
              {enquiry.phone}
            </a>
          ) : null}
          {enquiry.company ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Building2 className="h-4 w-4" aria-hidden="true" />
              {enquiry.company}
            </span>
          ) : null}
        </div>

        <p className="whitespace-pre-wrap break-words rounded-md bg-muted/60 p-3 text-sm text-foreground">
          {enquiry.message}
        </p>

        {!enquiry.emailed ? (
          <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Not emailed to the inbox{enquiry.email_error ? `: ${enquiry.email_error}` : '.'} Reply from here instead,
              or email it again once mail is working.
            </span>
          </p>
        ) : null}

        {handled && enquiry.handled_by_name ? (
          <p className="text-xs text-muted-foreground">
            Handled by {enquiry.handled_by_name} on {formatDateTime(enquiry.handled_at)}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** Messages sent through the website's contact form. Platform staff only. */
export default function EnquiriesPage() {
  const [filter, setFilter] = useState('open')
  const [page, setPage] = useState(1)
  const [data, setData] = useState({ items: [], total: 0, open_count: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const abortRef = useRef(null)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(null)
    try {
      const result = await listEnquiries(
        { page, page_size: PAGE_SIZE, status: filter === 'all' ? undefined : filter },
        controller.signal,
      )
      setData(result)
    } catch (err) {
      if (axios.isCancel(err)) return
      setError(toApiError(err, 'Could not load enquiries'))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [page, filter])

  useEffect(() => {
    void load()
    return () => abortRef.current?.abort()
  }, [load])

  async function handleHandled(enquiry, handled) {
    setBusyId(enquiry.id)
    try {
      await setEnquiryHandled(enquiry.id, handled)
      toastSuccess(handled ? 'Marked as handled' : 'Opened again', enquiry.name)
      await load()
    } catch (err) {
      toastError('Could not update the enquiry', toApiError(err).message)
    } finally {
      setBusyId(null)
    }
  }

  async function handleResend(enquiry) {
    setBusyId(enquiry.id)
    try {
      await resendEnquiry(enquiry.id)
      toastSuccess('Emailed to the inbox', enquiry.name)
      await load()
    } catch (err) {
      toastError('Could not email it', toApiError(err).message)
    } finally {
      setBusyId(null)
    }
  }

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Enquiries"
        description="Messages sent through the contact form on pestbase.co.uk. Each is also emailed to the enquiries inbox; reply from there or here."
        badge={data.open_count ? <Badge variant="warning">{data.open_count} open</Badge> : null}
        actions={<RefreshButton onRefresh={load} loading={loading} />}
      />

      <div role="tablist" aria-label="Filter enquiries" className="inline-flex rounded-lg border bg-card p-1">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={filter === option.value}
            onClick={() => {
              setFilter(option.value)
              setPage(1)
            }}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              filter === option.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error ? (
        <Card>
          <ErrorState title="Could not load enquiries" message={error.message} onRetry={load} />
        </Card>
      ) : loading && data.items.length === 0 ? (
        <Card>
          <LoadingState message="Loading enquiries..." />
        </Card>
      ) : data.items.length === 0 ? (
        <Card>
          <EmptyState
            icon={Inbox}
            title={filter === 'open' ? 'No open enquiries' : 'No enquiries'}
            description={
              filter === 'open'
                ? 'Everything from the website has been handled.'
                : 'Messages from the website contact form will appear here.'
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {data.items.map((enquiry) => (
            <EnquiryCard
              key={enquiry.id}
              enquiry={enquiry}
              busy={busyId === enquiry.id}
              onHandled={handleHandled}
              onResend={handleResend}
            />
          ))}
          {data.total > PAGE_SIZE ? (
            <Card>
              <Pagination
                page={page}
                totalPages={totalPages}
                total={data.total}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
              />
            </Card>
          ) : null}
        </div>
      )}
    </div>
  )
}
