import api, { unwrap } from '@/lib/api'

/** GET /roles - every role, plus every permission there is, grouped. */
export async function listRoles(signal) {
  const response = await api.get('/roles', { signal })
  return unwrap(response)
}

/** POST /roles */
export async function createRole(payload) {
  const response = await api.post('/roles', payload)
  return unwrap(response)
}

/** PUT /roles/{key} */
export async function updateRole(key, payload) {
  const response = await api.put(`/roles/${key}`, payload)
  return unwrap(response)
}

/** DELETE /roles/{key} - refused by the API while anyone still has the role. */
export async function deleteRole(key) {
  const response = await api.delete(`/roles/${key}`)
  return unwrap(response)
}
