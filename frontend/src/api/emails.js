import api, { unwrap } from '@/lib/api'

/** Building the PDF and handing it to the mail server can take a while. */
const SEND_TIMEOUT = 90000

/** GET /emails/compose - the email a quote, invoice or report would be sent with. */
export async function composeEmail(kind, id) {
  const response = await api.get('/emails/compose', { params: { kind, id } })
  return unwrap(response)
}

/** POST /emails/send - email the document to the customer, with its PDF. */
export async function sendDocumentEmail(payload) {
  const response = await api.post('/emails/send', payload, { timeout: SEND_TIMEOUT })
  return unwrap(response)
}

/** POST /settings/email/test - send a test email with the saved settings (admin only). */
export async function sendTestEmail(to) {
  const response = await api.post('/settings/email/test', { to }, { timeout: SEND_TIMEOUT })
  return response.data
}
