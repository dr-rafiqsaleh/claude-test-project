import axios from 'axios'
import { useCallback, useEffect, useRef, useState } from 'react'

import * as rolesApi from '@/api/roles'
import { toApiError } from '@/lib/api'

/** Loads every role and the full permission list, and exposes CRUD helpers. */
export function useRoles() {
  const [roles, setRoles] = useState([])
  const [permissionGroups, setPermissionGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)

  const fetchRoles = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)

    try {
      const data = await rolesApi.listRoles(controller.signal)
      setRoles(data.roles)
      setPermissionGroups(data.permission_groups)
    } catch (err) {
      if (axios.isCancel(err)) return
      setError(toApiError(err, 'Could not load roles'))
      setRoles([])
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchRoles()
    return () => abortRef.current?.abort()
  }, [fetchRoles])

  const create = useCallback(
    async (payload) => {
      const created = await rolesApi.createRole(payload)
      await fetchRoles()
      return created
    },
    [fetchRoles],
  )

  const update = useCallback(
    async (key, payload) => {
      const updated = await rolesApi.updateRole(key, payload)
      await fetchRoles()
      return updated
    },
    [fetchRoles],
  )

  const remove = useCallback(
    async (key) => {
      await rolesApi.deleteRole(key)
      await fetchRoles()
    },
    [fetchRoles],
  )

  return { roles, permissionGroups, loading, error, refetch: fetchRoles, create, update, remove }
}
