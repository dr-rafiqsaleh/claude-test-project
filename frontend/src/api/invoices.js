import api, { API_BASE_URL, unwrap } from '@/lib/api'

function buildParams(params) {
  const query = {}
  if (params.page !== undefined) query.page = params.page
  if (params.page_size !== undefined) query.page_size = params.page_size
  if (params.status) query.status = params.status
  if (params.customer_id) query.customer_id = params.customer_id
  if (params.date_from) query.date_from = params.date_from
  if (params.date_to) query.date_to = params.date_to
  if (params.overdue_only) query.overdue_only = true
  if (params.q) query.q = params.q
  return query
}

/** GET /invoices - paginated, filterable invoice list. */
export async function listInvoices(params = {}, signal) {
  const response = await api.get('/invoices', { params: buildParams(params), signal })
  return unwrap(response)
}

/** GET /invoices/{id} */
export async function getInvoice(id, signal) {
  const response = await api.get(`/invoices/${id}`, { signal })
  return unwrap(response)
}

/** POST /invoices */
export async function createInvoice(data) {
  const response = await api.post('/invoices', data)
  return unwrap(response)
}

/** POST /invoices/from-job/{jobId} - raise an invoice against a completed job. */
export async function createInvoiceFromJob(jobId) {
  const response = await api.post(`/invoices/from-job/${jobId}`)
  return unwrap(response)
}

/** PUT /invoices/{id} - draft or sent invoices only. */
export async function updateInvoice(id, data) {
  const response = await api.put(`/invoices/${id}`, data)
  return unwrap(response)
}

/** PATCH /invoices/{id}/status - move the invoice through its lifecycle. */
export async function updateInvoiceStatus(id, status) {
  const response = await api.patch(`/invoices/${id}/status`, { status })
  return unwrap(response)
}

/**
 * POST /invoices/{id}/payments
 * `paymentData` is `{ amount, method, reference, notes, paid_at }`.
 */
export async function addPayment(id, paymentData) {
  const response = await api.post(`/invoices/${id}/payments`, paymentData)
  return unwrap(response)
}

/** DELETE /invoices/{id} - draft invoices only, admin only. */
export async function deleteInvoice(id) {
  const response = await api.delete(`/invoices/${id}`)
  return unwrap(response)
}

/** GET /invoices/summary - aggregate figures for the dashboard. */
export async function getInvoiceSummary(signal) {
  const response = await api.get('/invoices/summary', { signal })
  return unwrap(response)
}

/**
 * A URL that renders an invoice PDF, safe to use in an `<a download>`.
 *
 * The session lives in a cookie on this origin, and the browser sends it on a
 * plain anchor's request by itself, so there is nothing to add here.
 */
export function getInvoicePdfUrl(id) {
  return `${API_BASE_URL}/invoices/${id}/pdf`
}

/** GET /invoices/{id}/pdf - returns the rendered PDF as a Blob. */
export async function getInvoicePdf(id) {
  const response = await api.get(`/invoices/${id}/pdf`, { responseType: 'blob' })
  return response.data
}

/** Fetch the invoice PDF and trigger a browser download. */
export async function downloadInvoicePdf(id, invoiceNumber) {
  const blob = await getInvoicePdf(id)
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = `invoice-${invoiceNumber ?? id}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()

  URL.revokeObjectURL(url)
}
