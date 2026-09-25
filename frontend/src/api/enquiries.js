import api, { unwrap } from '@/lib/api'

/** GET /contact/enquiries - messages from the website's contact form (platform staff only). */
export async function listEnquiries(params = {}, signal) {
  const query = {}
  if (params.page !== undefined) query.page = params.page
  if (params.page_size !== undefined) query.page_size = params.page_size
  if (params.status) query.status = params.status

  const response = await api.get('/contact/enquiries', { params: query, signal })
  return unwrap(response)
}

/** PATCH /contact/enquiries/{id} - mark handled, or open again. */
export async function setEnquiryHandled(id, handled) {
  const response = await api.patch(`/contact/enquiries/${id}`, { handled })
  return unwrap(response)
}

/** POST /contact/enquiries/{id}/resend - email it to the inbox again. */
export async function resendEnquiry(id) {
  const response = await api.post(`/contact/enquiries/${id}/resend`)
  return unwrap(response)
}
