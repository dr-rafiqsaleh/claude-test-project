import axios from 'axios'
import { useCallback, useEffect, useRef, useState } from 'react'

import * as bookingsApi from '@/api/bookings'
import { toApiError } from '@/lib/api'

/** Loads a paginated booking list and exposes CRUD + lifecycle helpers. */
export function useBookings(params) {
  const [bookings, setBookings] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [mutating, setMutating] = useState(false)
  const [error, setError] = useState(null)

  const page = params.page ?? 1
  const pageSize = params.page_size ?? 20
  const paramsKey = JSON.stringify(params)
  const abortRef = useRef(null)

  const fetchBookings = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)

    try {
      const parsed = JSON.parse(paramsKey)
      const data = await bookingsApi.listBookings(parsed, controller.signal)
      setBookings(data.items)
      setTotal(data.total)
    } catch (err) {
      if (axios.isCancel(err)) return
      setError(toApiError(err, 'Could not load bookings'))
      setBookings([])
      setTotal(0)
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [paramsKey])

  useEffect(() => {
    void fetchBookings()
    return () => abortRef.current?.abort()
  }, [fetchBookings])

  const create = useCallback(async (data) => {
    setMutating(true)
    try {
      return await bookingsApi.createBooking(data)
    } finally {
      setMutating(false)
    }
  }, [])

  const update = useCallback(async (id, data) => {
    setMutating(true)
    try {
      return await bookingsApi.updateBooking(id, data)
    } finally {
      setMutating(false)
    }
  }, [])

  const updateStatus = useCallback(
    async (id, status, reason) => {
      setMutating(true)
      try {
        const updated = await bookingsApi.updateBookingStatus(id, status, reason)
        await fetchBookings()
        return updated
      } finally {
        setMutating(false)
      }
    },
    [fetchBookings],
  )

  const remove = useCallback(
    async (id) => {
      setMutating(true)
      try {
        await bookingsApi.deleteBooking(id)
        await fetchBookings()
      } finally {
        setMutating(false)
      }
    },
    [fetchBookings],
  )

  return {
    bookings,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    loading,
    error,
    refetch: fetchBookings,
    create,
    update,
    updateStatus,
    remove,
    mutating,
  }
}

/** Loads a single booking by id. */
export function useBooking(id) {
  const [booking, setBooking] = useState(null)
  const [loading, setLoading] = useState(Boolean(id))
  const [error, setError] = useState(null)

  const fetchBooking = useCallback(async () => {
    if (!id) {
      setBooking(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      setBooking(await bookingsApi.getBooking(id))
    } catch (err) {
      if (axios.isCancel(err)) return
      setError(toApiError(err, 'Could not load this booking'))
      setBooking(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void fetchBooking()
  }, [fetchBooking])

  return { booking, loading, error, refetch: fetchBooking, setBooking }
}

/**
 * Loads calendar events for a date range. `dateFrom`/`dateTo` are ISO strings;
 * pass `enabled: false` to hold off fetching until the range is known.
 */
export function useCalendarEvents({ dateFrom, dateTo, technicianId, enabled = true }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)

  const fetchEvents = useCallback(async () => {
    if (!enabled || !dateFrom || !dateTo) {
      setEvents([])
      setLoading(false)
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)

    try {
      const data = await bookingsApi.getCalendarEvents(
        dateFrom,
        dateTo,
        technicianId,
        controller.signal,
      )
      setEvents(Array.isArray(data) ? data : [])
    } catch (err) {
      if (axios.isCancel(err)) return
      setError(toApiError(err, 'Could not load the calendar'))
      setEvents([])
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [dateFrom, dateTo, technicianId, enabled])

  useEffect(() => {
    void fetchEvents()
    return () => abortRef.current?.abort()
  }, [fetchEvents])

  return { events, loading, error, refetch: fetchEvents }
}

/** Loads the active technicians available for assignment (admin/office staff). */
export function useTechnicians(enabled = true) {
  const [technicians, setTechnicians] = useState([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!enabled) {
      setTechnicians([])
      setLoading(false)
      return undefined
    }

    const controller = new AbortController()
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const data = await bookingsApi.listTechnicians(controller.signal)
        if (!cancelled) setTechnicians(data?.items ?? [])
      } catch (err) {
        if (axios.isCancel(err) || cancelled) return
        setError(toApiError(err, 'Could not load technicians'))
        setTechnicians([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [enabled])

  return { technicians, loading, error }
}
