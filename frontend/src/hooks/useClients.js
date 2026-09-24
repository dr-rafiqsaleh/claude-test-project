import axios from 'axios'
import { useCallback, useEffect, useRef, useState } from 'react'

import * as clientsApi from '@/api/clients'
import { toApiError } from '@/lib/api'

/** Loads the paginated client list and exposes CRUD helpers (platform staff). */
export function useClients(params) {
  const [clients, setClients] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const page = params.page ?? 1
  const pageSize = params.page_size ?? 20
  const paramsKey = JSON.stringify(params)
  const abortRef = useRef(null)

  const fetchClients = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)

    try {
      const data = await clientsApi.listClients(JSON.parse(paramsKey), controller.signal)
      setClients(data.items)
      setTotal(data.total)
    } catch (err) {
      if (axios.isCancel(err)) return
      setError(toApiError(err, 'Could not load clients'))
      setClients([])
      setTotal(0)
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [paramsKey])

  useEffect(() => {
    void fetchClients()
    return () => abortRef.current?.abort()
  }, [fetchClients])

  const create = useCallback(
    async (payload) => {
      const created = await clientsApi.createClient(payload)
      await fetchClients()
      return created
    },
    [fetchClients],
  )

  const update = useCallback(
    async (id, payload) => {
      const updated = await clientsApi.updateClient(id, payload)
      await fetchClients()
      return updated
    },
    [fetchClients],
  )

  const remove = useCallback(
    async (id) => {
      await clientsApi.deleteClient(id)
      await fetchClients()
    },
    [fetchClients],
  )

  return {
    clients,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    loading,
    error,
    refetch: fetchClients,
    create,
    update,
    remove,
  }
}
