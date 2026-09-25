import api, { unwrap } from '@/lib/api'
import { saveBlob } from '@/lib/saveFile'

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
/** GET /emails/history - every email sent (or attempted) for one document. */
export async function documentEmailHistory(kind, id) {
  const response = await api.get('/emails/history', { params: { kind, id } })
  return unwrap(response)
}

/** GET /emails/customer/{id} - every email sent (or attempted) to one customer. */
export async function customerEmailHistory(customerId) {
  const response = await api.get(`/emails/customer/${customerId}`)
  return unwrap(response)
}

/** GET /emails/{id} - the full record of one email. */
export async function getEmailRecord(id) {
  const response = await api.get(`/emails/${id}`)
  return unwrap(response)
}

async function download(path, filename) {
  const response = await api.get(path, { responseType: 'blob' })
  await saveBlob(response.data, filename)
}

/** Download the attachment exactly as it was sent. */
export function downloadEmailAttachment(record) {
  return download(`/emails/${record.id}/attachment`, record.attachment_name || 'attachment.pdf')
}

/** Download the email as a .eml file, which opens in Outlook or any mail app. */
export function downloadEmailEml(record) {
  return download(`/emails/${record.id}/eml`, `Email ${record.document_number}.eml`)
}
