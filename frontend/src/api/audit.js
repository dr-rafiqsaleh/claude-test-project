import api, { unwrap } from '@/lib/api'

/** GET /audit - the client's audit trail, newest first. */
export async function listAuditEvents(params = {}, signal) {
  const query = {}
  if (params.page !== undefined) query.page = params.page
  if (params.page_size !== undefined) query.page_size = params.page_size
  if (params.event_type) query.event_type = params.event_type
  if (params.platform_only) query.platform_only = true

  const response = await api.get('/audit', { params: query, signal })
  return unwrap(response)
}

/** GET /audit/verify - re-hashes the chain and reports the first break. */
export async function verifyAuditChain(signal) {
  const response = await api.get('/audit/verify', { signal })
  return unwrap(response)
}
