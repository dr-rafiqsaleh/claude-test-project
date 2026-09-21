import api, { unwrap } from '@/lib/api'

function buildParams(params) {
  const query = {}
  if (params.page !== undefined) query.page = params.page
  if (params.page_size !== undefined) query.page_size = params.page_size
  if (params.role) query.role = params.role
  if (params.is_active !== undefined) query.is_active = params.is_active
  if (params.q) query.q = params.q
  return query
}

/** GET /users - paginated user list (admin only). */
export async function listUsers(params = {}, signal) {
  const response = await api.get('/users', { params: buildParams(params), signal })
  return unwrap(response)
}

/** GET /users/{id} */
export async function getUser(id, signal) {
  const response = await api.get(`/users/${id}`, { signal })
  return unwrap(response)
}

/** POST /users */
export async function createUser(payload) {
  const response = await api.post('/users', payload)
  return unwrap(response)
}

/** PUT /users/{id} */
export async function updateUser(id, payload) {
  const response = await api.put(`/users/${id}`, payload)
  return unwrap(response)
}

/** DELETE /users/{id} - deactivates the account. */
export async function deleteUser(id) {
  const response = await api.delete(`/users/${id}`)
  return unwrap(response)
}
