import axios from 'axios'
import { useCallback, useEffect, useRef, useState } from 'react'

import * as usersApi from '@/api/users'
import { toApiError } from '@/lib/api'

/** Loads a paginated user list and exposes CRUD helpers (admin only). */
export function useUsers(params) {
  const [users, setUsers] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [mutating, setMutating] = useState(false)
  const [error, setError] = useState(null)

  const page = params.page ?? 1
  const pageSize = params.page_size ?? 20
  const paramsKey = JSON.stringify(params)
  const abortRef = useRef(null)

  const fetchUsers = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)

    try {
      const parsed = JSON.parse(paramsKey)
      const data = await usersApi.listUsers(parsed, controller.signal)
      setUsers(data.items)
      setTotal(data.total)
    } catch (err) {
      if (axios.isCancel(err)) return
      setError(toApiError(err, 'Could not load users'))
      setUsers([])
      setTotal(0)
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [paramsKey])

  useEffect(() => {
    void fetchUsers()
    return () => abortRef.current?.abort()
  }, [fetchUsers])

  const create = useCallback(
    async (payload) => {
      setMutating(true)
      try {
        const created = await usersApi.createUser(payload)
        await fetchUsers()
        return created
      } finally {
        setMutating(false)
      }
    },
    [fetchUsers],
  )

  const update = useCallback(
    async (id, payload) => {
      setMutating(true)
      try {
        const updated = await usersApi.updateUser(id, payload)
        await fetchUsers()
        return updated
      } finally {
        setMutating(false)
      }
    },
    [fetchUsers],
  )

  const remove = useCallback(
    async (id) => {
      setMutating(true)
      try {
        await usersApi.deleteUser(id)
        await fetchUsers()
      } finally {
        setMutating(false)
      }
    },
    [fetchUsers],
  )

  return {
    users,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    loading,
    error,
    refetch: fetchUsers,
    create,
    update,
    remove,
    mutating,
  }
}
