import axios from 'axios'
import { useCallback, useEffect, useRef, useState } from 'react'

import * as quotesApi from '@/api/quotes'
import { toApiError } from '@/lib/api'

/** Loads a paginated quote list and exposes CRUD + lifecycle helpers. */
export function useQuotes(params) {
  const [quotes, setQuotes] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [mutating, setMutating] = useState(false)
  const [error, setError] = useState(null)

  const page = params.page ?? 1
  const pageSize = params.page_size ?? 20
  const paramsKey = JSON.stringify(params)
  const abortRef = useRef(null)

  const fetchQuotes = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)

    try {
      const parsed = JSON.parse(paramsKey)
      const data = await quotesApi.listQuotes(parsed, controller.signal)
      setQuotes(data.items)
      setTotal(data.total)
    } catch (err) {
      if (axios.isCancel(err)) return
      setError(toApiError(err, 'Could not load quotes'))
      setQuotes([])
      setTotal(0)
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [paramsKey])

  useEffect(() => {
    void fetchQuotes()
    return () => abortRef.current?.abort()
  }, [fetchQuotes])

  const create = useCallback(async (data) => {
    setMutating(true)
    try {
      return await quotesApi.createQuote(data)
    } finally {
      setMutating(false)
    }
  }, [])

  const update = useCallback(async (id, data) => {
    setMutating(true)
    try {
      return await quotesApi.updateQuote(id, data)
    } finally {
      setMutating(false)
    }
  }, [])

  const updateStatus = useCallback(
    async (id, status, reason) => {
      setMutating(true)
      try {
        const updated = await quotesApi.updateQuoteStatus(id, status, reason)
        await fetchQuotes()
        return updated
      } finally {
        setMutating(false)
      }
    },
    [fetchQuotes],
  )

  const remove = useCallback(
    async (id) => {
      setMutating(true)
      try {
        await quotesApi.deleteQuote(id)
        await fetchQuotes()
      } finally {
        setMutating(false)
      }
    },
    [fetchQuotes],
  )

  return {
    quotes,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    loading,
    error,
    refetch: fetchQuotes,
    create,
    update,
    updateStatus,
    remove,
    mutating,
  }
}

/** Loads a single quote by id. */
export function useQuote(id) {
  const [quote, setQuote] = useState(null)
  const [loading, setLoading] = useState(Boolean(id))
  const [error, setError] = useState(null)

  const fetchQuote = useCallback(async () => {
    if (!id) {
      setQuote(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      setQuote(await quotesApi.getQuote(id))
    } catch (err) {
      if (axios.isCancel(err)) return
      setError(toApiError(err, 'Could not load this quote'))
      setQuote(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void fetchQuote()
  }, [fetchQuote])

  return { quote, loading, error, refetch: fetchQuote, setQuote }
}
