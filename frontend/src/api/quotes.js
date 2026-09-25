import api, { unwrap } from '@/lib/api'
import { saveBlob } from '@/lib/saveFile'

function buildParams(params) {
  const query = {}
  if (params.page !== undefined) query.page = params.page
  if (params.page_size !== undefined) query.page_size = params.page_size
  if (params.status) query.status = params.status
  if (params.customer_id) query.customer_id = params.customer_id
  if (params.q) query.q = params.q
  return query
}

/** GET /quotes - paginated, filterable quote list. */
export async function listQuotes(params = {}, signal) {
  const response = await api.get('/quotes', { params: buildParams(params), signal })
  return unwrap(response)
}

/** GET /quotes/{id} */
export async function getQuote(id, signal) {
  const response = await api.get(`/quotes/${id}`, { signal })
  return unwrap(response)
}

/** POST /quotes */
export async function createQuote(data) {
  const response = await api.post('/quotes', data)
  return unwrap(response)
}

/** PUT /quotes/{id} - draft quotes only. */
export async function updateQuote(id, data) {
  const response = await api.put(`/quotes/${id}`, data)
  return unwrap(response)
}

/** PATCH /quotes/{id}/status - move the quote through its lifecycle. */
export async function updateQuoteStatus(id, status, reason) {
  const response = await api.patch(`/quotes/${id}/status`, {
    status,
    rejection_reason: reason ?? null,
  })
  return unwrap(response)
}

/** DELETE /quotes/{id} - draft quotes only. */
export async function deleteQuote(id) {
  const response = await api.delete(`/quotes/${id}`)
  return unwrap(response)
}

/** GET /quotes/{id}/pdf - returns the rendered PDF as a Blob. */
export async function getQuotePdf(id) {
  const response = await api.get(`/quotes/${id}/pdf`, { responseType: 'blob' })
  return response.data
}

/** Fetch the PDF and download it (or share it, in the app). */
export async function downloadQuotePdf(id, quoteNumber) {
  const blob = await getQuotePdf(id)
  await saveBlob(blob, `quote-${quoteNumber}.pdf`)
}
