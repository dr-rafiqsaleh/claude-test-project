import api, { unwrap } from '@/lib/api'

/** GET /platform-settings - how PestBase sends email, for every client. */
export async function getPlatformSettings(signal) {
  const response = await api.get('/platform-settings', { signal })
  return unwrap(response)
}

/** PUT /platform-settings - secrets left blank keep what is stored. */
export async function updatePlatformSettings(payload) {
  const response = await api.put('/platform-settings', payload)
  return unwrap(response)
}

/** POST /platform-settings/email/test */
export async function sendPlatformTestEmail(to) {
  const response = await api.post('/platform-settings/email/test', { to })
  return response.data
}
