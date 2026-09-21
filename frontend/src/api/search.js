import api, { unwrap } from '@/lib/api'

/** The collections the search endpoint understands, in display order. */
export const SEARCH_TYPES = ['customers', 'quotes', 'bookings', 'jobs', 'invoices']

/**
 * GET /search - one call across customers, quotes, bookings, jobs and invoices.
 *
 * @param {string} q       Search term (the API requires at least 2 characters).
 * @param {string[]|string} types  Collections to search; omit for all of them.
 * @param {number} limit   Maximum results per collection (1-20).
 * @param {AbortSignal} signal
 * @returns {Promise<{results: object, total_count: number, query: string}>}
 */
export async function searchAll(q, types, limit = 5, signal) {
  const params = { q }

  if (types) {
    const list = Array.isArray(types) ? types : String(types).split(',')
    const cleaned = list.map((item) => String(item).trim()).filter(Boolean)
    if (cleaned.length > 0 && cleaned.length < SEARCH_TYPES.length) {
      params.types = cleaned.join(',')
    }
  }

  if (limit) params.limit = limit

  const response = await api.get('/search', { params, signal })
  return unwrap(response)
}
