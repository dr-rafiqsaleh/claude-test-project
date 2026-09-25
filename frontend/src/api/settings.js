import api, { API_BASE_URL, unwrap } from '@/lib/api'

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
 * The session cookie goes with an image request on this origin by itself. `v`
 * is a cache-buster, so a freshly uploaded logo shows up immediately.
 */
export function getLogoUrl(version) {
  const base = `${API_BASE_URL}/settings/logo`
  return version ? `${base}?v=${encodeURIComponent(String(version))}` : base
}
