import axios from 'axios'
import { useCallback, useEffect, useRef, useState } from 'react'

import * as invoicesApi from '@/api/invoices'
import { toApiError } from '@/lib/api'

/** Loads a paginated invoice list and exposes CRUD + lifecycle helpers. */
export function useInvoices(params) {
  const [invoices, setInvoices] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [mutating, setMutating] = useState(false)
  const [error, setError] = useState(null)

  const page = params.page ?? 1
  const pageSize = params.page_size ?? 20
  const paramsKey = JSON.stringify(params)
  const abortRef = useRef(null)

  const fetchInvoices = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)

    try {
      const parsed = JSON.parse(paramsKey)
      const data = await invoicesApi.listInvoices(parsed, controller.signal)
      setInvoices(data.items)
      setTotal(data.total)
    } catch (err) {
      if (axios.isCancel(err)) return
      setError(toApiError(err, 'Could not load invoices'))
      setInvoices([])
      setTotal(0)
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [paramsKey])

  useEffect(() => {
    void fetchInvoices()
    return () => abortRef.current?.abort()
  }, [fetchInvoices])

  const create = useCallback(async (data) => {
    setMutating(true)
    try {
      return await invoicesApi.createInvoice(data)
    } finally {
      setMutating(false)
    }
  }, [])

  const createFromJob = useCallback(
    async (jobId) => {
      setMutating(true)
      try {
        const created = await invoicesApi.createInvoiceFromJob(jobId)
        await fetchInvoices()
        return created
      } finally {
        setMutating(false)
      }
    },
    [fetchInvoices],
  )

  const update = useCallback(async (id, data) => {
    setMutating(true)
    try {
      return await invoicesApi.updateInvoice(id, data)
    } finally {
      setMutating(false)
    }
  }, [])

  const updateStatus = useCallback(
    async (id, status) => {
      setMutating(true)
      try {
        const updated = await invoicesApi.updateInvoiceStatus(id, status)
        await fetchInvoices()
        return updated
      } finally {
        setMutating(false)
      }
    },
    [fetchInvoices],
  )

  const recordPayment = useCallback(
    async (id, paymentData) => {
      setMutating(true)
      try {
        const updated = await invoicesApi.addPayment(id, paymentData)
        await fetchInvoices()
        return updated
      } finally {
        setMutating(false)
      }
    },
    [fetchInvoices],
  )

  const remove = useCallback(
    async (id) => {
      setMutating(true)
      try {
        await invoicesApi.deleteInvoice(id)
        await fetchInvoices()
      } finally {
        setMutating(false)
      }
    },
    [fetchInvoices],
  )

  return {
    invoices,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    loading,
    error,
    refetch: fetchInvoices,
    create,
    createFromJob,
    update,
    updateStatus,
    recordPayment,
    remove,
    mutating,
  }
}

/** Loads a single invoice by id. */
export function useInvoice(id) {
  const [invoice, setInvoice] = useState(null)
  const [loading, setLoading] = useState(Boolean(id))
  const [error, setError] = useState(null)

  const fetchInvoice = useCallback(async () => {
    if (!id) {
      setInvoice(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      setInvoice(await invoicesApi.getInvoice(id))
    } catch (err) {
      if (axios.isCancel(err)) return
      setError(toApiError(err, 'Could not load this invoice'))
      setInvoice(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void fetchInvoice()
  }, [fetchInvoice])

  return { invoice, loading, error, refetch: fetchInvoice, setInvoice }
}

/** Loads the aggregate invoicing figures shown on the dashboard. */
export function useInvoiceSummary() {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)

  const fetchSummary = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)

    try {
      setSummary(await invoicesApi.getInvoiceSummary(controller.signal))
    } catch (err) {
      if (axios.isCancel(err)) return
      setError(toApiError(err, 'Could not load the invoice summary'))
      setSummary(null)
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchSummary()
    return () => abortRef.current?.abort()
  }, [fetchSummary])

  return { summary, loading, error, refetch: fetchSummary }
}
