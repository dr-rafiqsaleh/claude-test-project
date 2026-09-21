import axios from 'axios'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { searchAll } from '@/api/search'
import { useDebounce } from '@/hooks/useDebounce'
import { toApiError } from '@/lib/api'

/** Fewer characters than this and we do not bother the server. */
export const MIN_QUERY_LENGTH = 2

/** How long typing has to pause before a search fires. */
const DEBOUNCE_MS = 300

const EMPTY_RESULTS = {
  customers: [],
  quotes: [],
  bookings: [],
  jobs: [],
  invoices: [],
}

/**
 * Debounced global search.
 *
 * Returns `{ query, setQuery, results, totalCount, isLoading, error, ... }`
 * where `results` is always the full grouped shape, so callers never have to
 * guard against a missing bucket.
 */
export function useSearch({ limit = 5, types, initialQuery = '' } = {}) {
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState(EMPTY_RESULTS)
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)

  // Bumped by `retry()` to force the effect to re-run on an unchanged query.
  const [nonce, setNonce] = useState(0)

  const debouncedQuery = useDebounce(query, DEBOUNCE_MS)
  const abortRef = useRef(null)

  // Serialised so an inline array literal from the caller cannot re-trigger
  // the effect on every render.
  const typesKey = useMemo(
    () => (Array.isArray(types) ? types.join(',') : types ?? ''),
    [types],
  )

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setResults(EMPTY_RESULTS)
    setTotalCount(0)
    setIsLoading(false)
    setError(null)
  }, [])

  useEffect(() => {
    const term = debouncedQuery.trim()

    if (term.length < MIN_QUERY_LENGTH) {
      abortRef.current?.abort()
      setResults(EMPTY_RESULTS)
      setTotalCount(0)
      setIsLoading(false)
      setError(null)
      return undefined
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsLoading(true)
    setError(null)

    async function run() {
      try {
        const data = await searchAll(
          term,
          typesKey ? typesKey.split(',') : undefined,
          limit,
          controller.signal,
        )
        if (controller.signal.aborted) return
        setResults({ ...EMPTY_RESULTS, ...(data?.results ?? {}) })
        setTotalCount(data?.total_count ?? 0)
      } catch (err) {
        if (axios.isCancel(err) || controller.signal.aborted) return
        setError(toApiError(err, 'Search is unavailable right now'))
        setResults(EMPTY_RESULTS)
        setTotalCount(0)
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }

    void run()
    return () => controller.abort()
  }, [debouncedQuery, typesKey, limit, nonce])

  useEffect(() => () => abortRef.current?.abort(), [])

  const retry = useCallback(() => setNonce((value) => value + 1), [])

  return {
    query,
    setQuery,
    debouncedQuery,
    results,
    totalCount,
    isLoading,
    error,
    reset,
    retry,
    hasQuery: query.trim().length >= MIN_QUERY_LENGTH,
  }
}

export default useSearch
