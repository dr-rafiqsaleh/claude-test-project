import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, Mail, Paperclip, Send } from 'lucide-react'

import { composeEmail, sendDocumentEmail } from '@/api/emails'
import { Button } from '@/components/ui/button'
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
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { toastSuccess } from '@/components/ui/use-toast'
import { toApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'

const TITLES = { quote: 'Email quote', invoice: 'Email invoice', report: 'Email report' }

/** "a@x.com, b@y.com" -> ["a@x.com", "b@y.com"] */
function splitAddresses(value) {
  return value
    .split(/[,;\s]+/)
    .map((address) => address.trim())
    .filter(Boolean)
}

/**
 * Email a quote, invoice or report to the customer, with its PDF attached.
 *
 * Opens pre-filled from the template in Settings; everything can be changed
 * before sending. `onSent()` runs after a successful send, so the page can
 * refresh (a draft quote or invoice becomes sent).
 */
export function EmailDialog({ kind, documentId, open, onOpenChange, onSent }) {
  const isAdmin = useAuthStore((state) => state.isAdmin())
  const [draft, setDraft] = useState(null)
  const [form, setForm] = useState({ to: '', cc: '', subject: '', body: '' })
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [saveToCustomer, setSaveToCustomer] = useState(true)

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    setLoading(true)
    setError(null)
    composeEmail(kind, documentId)
      .then((data) => {
        if (cancelled) return
        setDraft(data)
        setForm({
          to: data.to.join(', '),
          cc: data.cc.join(', '),
          subject: data.subject,
          body: data.body,
        })
      })
      .catch((err) => {
        if (!cancelled) setError(toApiError(err, 'Could not prepare the email').message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, kind, documentId])

  function set(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function handleSend() {
    const to = splitAddresses(form.to)
    if (to.length === 0) {
      setError('Add at least one address to send to.')
      return
    }
    setSending(true)
    setError(null)
    try {
      await sendDocumentEmail({
        kind,
        id: documentId,
        to,
        cc: splitAddresses(form.cc),
        subject: form.subject,
        body: form.body,
        save_to_customer: Boolean(draft && !draft.customer_has_email && saveToCustomer),
      })
      toastSuccess('Email sent', `Sent to ${to.join(', ')}.`)
      onOpenChange(false)
      onSent?.()
    } catch (err) {
      // Kept in the dialog, where the details can be fixed and sent again.
      // The failed attempt is on the record too.
      setError(toApiError(err, 'Could not send the email').message)
      onSent?.()
    } finally {
      setSending(false)
    }
  }

  const notConfigured = draft && !draft.configured

  return (
    <Dialog open={open} onOpenChange={(next) => !sending && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{TITLES[kind]}</DialogTitle>
          <DialogDescription>
            Filled in from your template in Settings. Change anything before sending.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : notConfigured ? (
          <div className="flex items-start gap-3 rounded-md border border-border bg-muted/50 p-4 text-sm">
            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="font-medium text-foreground">Email isn&apos;t set up yet</p>
              <p className="text-muted-foreground">
                {isAdmin ? (
                  <>
                    Set it up in <Link to="/settings" className="text-primary hover:underline">Settings</Link>,
                    under Email.
                  </>
                ) : (
                  'Ask an admin to set it up in Settings, under Email.'
                )}
              </p>
            </div>
          </div>
        ) : draft ? (
          <div className="space-y-4">
            {!draft.customer_has_email ? (
              <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-2">
                  <p>
                    <span className="font-medium">{draft.customer_name ?? 'This customer'} has no email
                    address saved.</span>{' '}
                    Type the address below before sending.
                  </p>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={saveToCustomer}
                      onChange={(event) => setSaveToCustomer(event.target.checked)}
                      className="h-4 w-4 rounded border-input text-primary focus:ring-ring"
                    />
                    Save it to their record for next time
                  </label>
                </div>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="email-to">To</Label>
              <Input
                id="email-to"
                type="text"
                inputMode="email"
                value={form.to}
                onChange={(event) => set('to', event.target.value)}
                placeholder="customer@example.com"
              />
              <p className="text-xs text-muted-foreground">Separate several addresses with commas.</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email-cc">Cc</Label>
              <Input
                id="email-cc"
                type="text"
                inputMode="email"
                value={form.cc}
                onChange={(event) => set('cc', event.target.value)}
                placeholder="Optional, e.g. the letting agent or tenant"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email-subject">Subject</Label>
              <Input
                id="email-subject"
                value={form.subject}
                onChange={(event) => set('subject', event.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email-body">Message</Label>
              <Textarea
                id="email-body"
                rows={9}
                value={form.body}
                onChange={(event) => set('body', event.target.value)}
              />
            </div>

            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Paperclip className="h-4 w-4" />
              {draft.attachment_name}
            </p>

            {draft.history.some((log) => log.status === 'sent') ? (
              <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Already sent</p>
                <ul className="mt-1 space-y-0.5">
                  {draft.history
                    .filter((log) => log.status === 'sent')
                    .slice(0, 3)
                    .map((log) => (
                      <li key={log.id}>
                        {formatDateTime(log.sent_at)} to {log.to.join(', ')}
                        {log.sent_by_name ? ` by ${log.sent_by_name}` : ''}
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" disabled={sending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {draft && !notConfigured ? (
            <Button disabled={sending || loading} onClick={() => void handleSend()}>
              {sending ? <Spinner size="sm" className="text-current" /> : <Send className="h-4 w-4" />}
              {sending ? 'Sending...' : 'Send email'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default EmailDialog
