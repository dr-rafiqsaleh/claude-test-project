import axios from 'axios'
import { useCallback, useEffect, useRef, useState } from 'react'

import * as customersApi from '@/api/customers'
import { toApiError } from '@/lib/api'

/** Loads a paginated customer list and exposes CRUD helpers. */
export function useCustomers(params) {
  const [customers, setCustomers] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [mutating, setMutating] = useState(false)
  const [error, setError] = useState(null)

  const page = params.page ?? 1
  const pageSize = params.page_size ?? 20
  const paramsKey = JSON.stringify(params)
  const abortRef = useRef(null)

  const fetchCustomers = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)

    try {
      const parsed = JSON.parse(paramsKey)
      const data = await customersApi.listCustomers(parsed, controller.signal)
      setCustomers(data.items)
      setTotal(data.total)
    } catch (err) {
      if (axios.isCancel(err)) return
      setError(toApiError(err, 'Could not load customers'))
      setCustomers([])
      setTotal(0)
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [paramsKey])

  useEffect(() => {
    void fetchCustomers()
    return () => abortRef.current?.abort()
  }, [fetchCustomers])

  const create = useCallback(async (payload) => {
    setMutating(true)
    try {
      return await customersApi.createCustomer(payload)
    } finally {
      setMutating(false)
    }
  }, [])

  const update = useCallback(async (id, payload) => {
    setMutating(true)
    try {
      return await customersApi.updateCustomer(id, payload)
    } finally {
      setMutating(false)
    }
  }, [])

  const remove = useCallback(
    async (id) => {
      setMutating(true)
      try {
        await customersApi.deleteCustomer(id)
        await fetchCustomers()
      } finally {
        setMutating(false)
      }
    },
    [fetchCustomers],
  )

  return {
    customers,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    loading,
    error,
    refetch: fetchCustomers,
    create,
    update,
    remove,
    mutating,
  }
}

/** Loads a single customer by id. */
export function useCustomer(id) {
  const [customer, setCustomer] = useState(null)
  const [loading, setLoading] = useState(Boolean(id))
  const [error, setError] = useState(null)

  const fetchCustomer = useCallback(async () => {
    if (!id) {
      setCustomer(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      setCustomer(await customersApi.getCustomer(id))
    } catch (err) {
      if (axios.isCancel(err)) return
      setError(toApiError(err, 'Could not load this customer'))
      setCustomer(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void fetchCustomer()
  }, [fetchCustomer])

  return { customer, loading, error, refetch: fetchCustomer }
}
