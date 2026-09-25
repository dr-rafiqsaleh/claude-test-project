import { useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Download, FileText, Mail, ShieldCheck } from 'lucide-react'

import {
  customerEmailHistory,
  documentEmailHistory,
  downloadEmailAttachment,
  downloadEmailEml,
  getEmailRecord,
} from '@/api/emails'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { toastError } from '@/components/ui/use-toast'
import { toApiError } from '@/lib/api'
import { cn, formatDateTime } from '@/lib/utils'

const KIND_LABELS = { quote: 'Quote', invoice: 'Invoice', report: 'Report' }

function sizeLabel(bytes) {
  if (!bytes) return ''
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function StatusPill({ status }) {
  const sent = status === 'sent'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        sent ? 'bg-primary/15 text-primary' : 'bg-destructive/15 text-destructive',
      )}
    >
      {sent ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
      {sent ? 'Sent' : 'Failed'}
    </span>
  )
}

function Row({ label, children }) {
  if (!children) return null
  return (
    <div className="grid gap-1 sm:grid-cols-[8rem_1fr] sm:gap-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-foreground">{children}</dd>
    </div>
  )
}

/** The full record of one email, as evidence of what was sent and when. */
function EmailRecordDialog({ recordId, onClose }) {
  const [record, setRecord] = useState(null)
  const [busy, setBusy] = useState(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!recordId) return undefined
    let cancelled = false
    setRecord(null)
    getEmailRecord(recordId)
      .then((data) => !cancelled && setRecord(data))
      .catch((err) => {
        toastError('Could not open the email record', toApiError(err).message)
        onCloseRef.current()
      })
    return () => {
      cancelled = true
    }
  }, [recordId])

  async function run(action, key) {
    setBusy(key)
    try {
      await action(record)
    } catch (err) {
      toastError('Download failed', toApiError(err).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={Boolean(recordId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Email record</DialogTitle>
          <DialogDescription>
            PestBase&apos;s permanent record of this email. It can&apos;t be changed or deleted.
          </DialogDescription>
        </DialogHeader>

        {!record ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : (
          <div className="space-y-5">
            <dl className="space-y-3">
              <Row label="Status">
                <span className="flex flex-wrap items-center gap-2">
                  <StatusPill status={record.status} />
                  {record.status === 'sent'
                    ? `Accepted for delivery on ${formatDateTime(record.sent_at)}`
                    : `Tried on ${formatDateTime(record.sent_at)}`}
                </span>
              </Row>
              {record.error ? <Row label="Why it failed">{record.error}</Row> : null}
              <Row label="From">
                {record.from_name ? `${record.from_name} <${record.from_address}>` : record.from_address}
              </Row>
              <Row label="To">{record.to.join(', ')}</Row>
              <Row label="Cc">{record.cc.join(', ')}</Row>
              <Row label="Hidden copy">{record.bcc.join(', ')}</Row>
              <Row label="Replies to">{record.reply_to}</Row>
              <Row label="Sent by">{record.sent_by_name}</Row>
              <Row label="Subject">{record.subject}</Row>
            </dl>

            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Message</p>
              <div className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground">
                {record.body}
              </div>
            </div>

            <dl className="space-y-3">
              <Row label="Attachment">
                {record.attachment_name
                  ? `${record.attachment_name} (${sizeLabel(record.attachment_size)})`
                  : null}
              </Row>
              <Row label="Fingerprint">
                {record.attachment_sha256 ? (
                  <span className="font-mono text-xs">SHA-256 {record.attachment_sha256}</span>
                ) : null}
              </Row>
              <Row label="Mail server">{record.provider_reference}</Row>
              <Row label="Message-ID">
                {record.message_id ? <span className="font-mono text-xs">{record.message_id}</span> : null}
              </Row>
            </dl>

            <div className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                The PDF below is the exact file that was attached; its fingerprint changes if even one
                byte is different. &ldquo;Accepted for delivery&rdquo; means the mail server took the
                email; it does not show that the customer opened it.
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {record.attachment_kept ? (
                <Button
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void run(downloadEmailAttachment, 'pdf')}
                >
                  {busy === 'pdf' ? <Spinner size="sm" /> : <FileText className="h-4 w-4" />}
                  PDF as sent
                </Button>
              ) : null}
              <Button variant="outline" disabled={busy !== null} onClick={() => void run(downloadEmailEml, 'eml')}>
                {busy === 'eml' ? <Spinner size="sm" /> : <Download className="h-4 w-4" />}
                Download email (.eml)
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Every email sent (or attempted) for a document, or to a customer, with the
 * full record of each one a tap away.
 *
 * Give `kind` + `documentId` for one document, or `customerId` for everything
 * sent to a customer. Change `refreshKey` to reload, e.g. after sending.
 */
export function EmailHistory({ kind, documentId, customerId, refreshKey = 0, className }) {
  const [records, setRecords] = useState(null)
  const [openId, setOpenId] = useState(null)

  useEffect(() => {
    let cancelled = false
    const load = customerId ? customerEmailHistory(customerId) : documentEmailHistory(kind, documentId)
    load
      .then((data) => !cancelled && setRecords(data))
      .catch(() => !cancelled && setRecords([]))
    return () => {
      cancelled = true
    }
  }, [kind, documentId, customerId, refreshKey])

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <CardTitle className="text-base">Emails</CardTitle>
          {records?.length ? <span className="text-sm text-muted-foreground">{records.length}</span> : null}
        </div>
        <CardDescription>
          A permanent record of what was sent, to whom and when, in case it&apos;s ever disputed.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {records === null ? (
          <div className="px-6 pb-6">
            <div className="h-9 animate-pulse rounded-md bg-muted" />
          </div>
        ) : records.length === 0 ? (
          <p className="border-t border-border px-6 py-6 text-center text-sm text-muted-foreground">
            Nothing emailed yet.
          </p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {records.map((record) => (
              <li key={record.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(record.id)}
                  className="flex w-full items-center gap-4 px-6 py-3 text-left transition-colors duration-150 hover:bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {customerId ? `${KIND_LABELS[record.document_type] ?? ''} ${record.document_number} · ` : ''}
                      {record.to.join(', ')}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatDateTime(record.sent_at)}
                      {record.sent_by_name ? ` · ${record.sent_by_name}` : ''} · {record.subject}
                    </p>
                  </div>
                  <StatusPill status={record.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <EmailRecordDialog recordId={openId} onClose={() => setOpenId(null)} />
    </Card>
  )
}

export default EmailHistory
