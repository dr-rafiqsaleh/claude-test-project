import api, { unwrap } from '@/lib/api'

function buildParams(params) {
  const query = {}
  if (params.page !== undefined) query.page = params.page
  if (params.page_size !== undefined) query.page_size = params.page_size
  if (params.q) query.q = params.q
  if (params.is_active !== undefined) query.is_active = params.is_active
  if (params.county) query.county = params.county
  if (params.city) query.city = params.city
  if (params.sort_by) query.sort_by = params.sort_by
  if (params.sort_desc !== undefined) query.sort_desc = params.sort_desc
  return query
}

/** GET /customers - paginated, searchable customer list. */
export async function listCustomers(params = {}, signal) {
  const response = await api.get('/customers', { params: buildParams(params), signal })
  return unwrap(response)
}

/** GET /customers/{id} */
export async function getCustomer(id, signal) {
  const response = await api.get(`/customers/${id}`, { signal })
  return unwrap(response)
}

/** POST /customers */
export async function createCustomer(payload) {
  const response = await api.post('/customers', payload)
  return unwrap(response)
}

/** PUT /customers/{id} */
export async function updateCustomer(id, payload) {
  const response = await api.put(`/customers/${id}`, payload)
  return unwrap(response)
}

/** DELETE /customers/{id} - soft delete (archives the record). */
export async function deleteCustomer(id) {
  const response = await api.delete(`/customers/${id}`)
  return unwrap(response)
}
