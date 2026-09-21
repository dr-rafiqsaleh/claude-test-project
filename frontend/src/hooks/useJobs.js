import axios from 'axios'
import { useCallback, useEffect, useRef, useState } from 'react'

import * as jobsApi from '@/api/jobs'
import { toApiError } from '@/lib/api'

/** Loads a paginated job list and exposes the lifecycle helpers. */
export function useJobs(params) {
  const [jobs, setJobs] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [mutating, setMutating] = useState(false)
  const [error, setError] = useState(null)

  const page = params.page ?? 1
  const pageSize = params.page_size ?? 20
  const paramsKey = JSON.stringify(params)
  const abortRef = useRef(null)

  const fetchJobs = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)

    try {
      const parsed = JSON.parse(paramsKey)
      const data = await jobsApi.listJobs(parsed, controller.signal)
      setJobs(data.items)
      setTotal(data.total)
    } catch (err) {
      if (axios.isCancel(err)) return
      setError(toApiError(err, 'Could not load jobs'))
      setJobs([])
      setTotal(0)
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [paramsKey])

  useEffect(() => {
    void fetchJobs()
    return () => abortRef.current?.abort()
  }, [fetchJobs])

  const createFromBooking = useCallback(
    async (bookingId) => {
      setMutating(true)
      try {
        const created = await jobsApi.createJobFromBooking(bookingId)
        await fetchJobs()
        return created
      } finally {
        setMutating(false)
      }
    },
    [fetchJobs],
  )

  const update = useCallback(async (id, data) => {
    setMutating(true)
    try {
      return await jobsApi.updateJob(id, data)
    } finally {
      setMutating(false)
    }
  }, [])

  const updateStatus = useCallback(
    async (id, status) => {
      setMutating(true)
      try {
        const updated = await jobsApi.updateJobStatus(id, status)
        await fetchJobs()
        return updated
      } finally {
        setMutating(false)
      }
    },
    [fetchJobs],
  )

  const remove = useCallback(
    async (id) => {
      setMutating(true)
      try {
        await jobsApi.deleteJob(id)
        await fetchJobs()
      } finally {
        setMutating(false)
      }
    },
    [fetchJobs],
  )

  return {
    jobs,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    loading,
    error,
    refetch: fetchJobs,
    createFromBooking,
    update,
    updateStatus,
    remove,
    mutating,
  }
}

/** Loads a single job by id. */
export function useJob(id) {
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(Boolean(id))
  const [error, setError] = useState(null)

  const fetchJob = useCallback(async () => {
    if (!id) {
      setJob(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      setJob(await jobsApi.getJob(id))
    } catch (err) {
      if (axios.isCancel(err)) return
      setError(toApiError(err, 'Could not load this job'))
      setJob(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void fetchJob()
  }, [fetchJob])

  return { job, loading, error, refetch: fetchJob, setJob }
}

/** Loads the photo metadata attached to a job. */
export function useJobPhotos(jobId) {
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(Boolean(jobId))
  const [error, setError] = useState(null)
  const abortRef = useRef(null)

  const fetchPhotos = useCallback(async () => {
    if (!jobId) {
      setPhotos([])
      setLoading(false)
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)

    try {
      const data = await jobsApi.listPhotos(jobId, controller.signal)
      setPhotos(data?.items ?? [])
    } catch (err) {
      if (axios.isCancel(err)) return
      setError(toApiError(err, 'Could not load photos'))
      setPhotos([])
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [jobId])

  useEffect(() => {
    void fetchPhotos()
    return () => abortRef.current?.abort()
  }, [fetchPhotos])

  const upload = useCallback(
    async (file) => {
      const created = await jobsApi.uploadPhoto(jobId, file)
      await fetchPhotos()
      return created
    },
    [jobId, fetchPhotos],
  )

  const remove = useCallback(
    async (photoId) => {
      await jobsApi.deletePhoto(jobId, photoId)
      await fetchPhotos()
    },
    [jobId, fetchPhotos],
  )

  return { photos, loading, error, refetch: fetchPhotos, upload, remove }
}
