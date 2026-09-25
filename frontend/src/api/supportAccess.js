import api, { unwrap } from '@/lib/api'

/** GET /support-access - whether PestBase support can help right now, plus history. */
export async function getSupportAccess(signal) {
  const response = await api.get('/support-access', { signal })
  return unwrap(response)
}

/** POST /support-access - open access for a set number of hours. */
export async function openSupportAccess(payload) {
  const response = await api.post('/support-access', payload)
  return unwrap(response)
}

/** DELETE /support-access - close it now rather than waiting for it to expire. */
export async function closeSupportAccess() {
  const response = await api.delete('/support-access')
  return unwrap(response)
}

/** POST /support-access/break-glass - PestBase opens a client without being asked. */
export async function breakGlass(payload) {
  const response = await api.post('/support-access/break-glass', payload)
  return unwrap(response)
}
