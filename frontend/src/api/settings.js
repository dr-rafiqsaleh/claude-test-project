import api, { API_BASE_URL, unwrap } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'

/** GET /settings - company profile, document defaults and appearance. */
export async function getSettings(signal) {
  const response = await api.get('/settings', { signal })
  return unwrap(response)
}

/** PUT /settings - partial update, admin only. */
export async function updateSettings(data) {
  const response = await api.put('/settings', data)
  return unwrap(response)
}

/** POST /settings/logo - multipart upload, admin only. */
export async function uploadLogo(file) {
  const body = new FormData()
  body.append('file', file)

  const response = await api.post('/settings/logo', body, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return unwrap(response)
}

/** DELETE /settings/logo - clear the stored logo, admin only. */
export async function removeLogo() {
  const response = await api.delete('/settings/logo')
  return unwrap(response)
}

/**
 * A URL that renders the company logo, safe to use in an `<img src>`.
 *
 * An image tag cannot carry an Authorization header, so the access token
 * travels in the query string - the API accepts it there for this endpoint.
 * The `v` cache-buster makes a freshly uploaded logo show up immediately.
 */
export function getLogoUrl(version) {
  const token = useAuthStore.getState().accessToken
  const params = new URLSearchParams()
  if (token) params.set('token', token)
  if (version) params.set('v', String(version))

  const query = params.toString()
  return query ? `${API_BASE_URL}/settings/logo?${query}` : `${API_BASE_URL}/settings/logo`
}
