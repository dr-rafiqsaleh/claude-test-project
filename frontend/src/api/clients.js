import api, { unwrap } from '@/lib/api'

/** GET /clients - the client companies using PestBase (platform staff only). */
export async function listClients(params = {}, signal) {
  const query = {}
  if (params.page !== undefined) query.page = params.page
  if (params.page_size !== undefined) query.page_size = params.page_size
  if (params.status) query.status = params.status
  if (params.q) query.q = params.q

  const response = await api.get('/clients', { params: query, signal })
  return unwrap(response)
}

/** POST /clients */
export async function createClient(payload) {
  const response = await api.post('/clients', payload)
  return unwrap(response)
}

/** PUT /clients/{id} - details, or suspend/close via `status`. */
export async function updateClient(id, payload) {
  const response = await api.put(`/clients/${id}`, payload)
  return unwrap(response)
}

/** DELETE /clients/{id} - refused once the client has any users. */
export async function deleteClient(id) {
  const response = await api.delete(`/clients/${id}`)
  return unwrap(response)
}
