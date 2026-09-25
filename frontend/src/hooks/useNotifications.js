import axios from 'axios'
import { useCallback, useEffect, useState } from 'react'

import * as notificationsApi from '@/api/notifications'
import { toApiError } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'

/** How often the unread badge re-checks with the server. */
const POLL_INTERVAL_MS = 60_000

/** How many notifications the shared store holds. */
const STORE_LIMIT = 100

/**
 * Notifications live in one module-level store rather than per-component state.
 *
 * The header bell and the notifications page are on screen at the same time;
 * without a shared store, marking everything read on the page would leave the
 * bell showing a stale badge until the next poll. Same pattern the toast
 * system uses.
 */
let state = {
  notifications: [],
  unreadCount: 0,
  isLoading: true,
  error: null,
}

const listeners = new Set()

function setState(patch) {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener(state))
}

let inflight = null
let controller = null

async function loadAll() {
  // Two components mounting together should share one request.
  if (inflight) return inflight

  controller?.abort()
  controller = new AbortController()
  const signal = controller.signal

  setState({ isLoading: true, error: null })

  inflight = (async () => {
    try {
      const data = await notificationsApi.getNotifications(false, STORE_LIMIT, signal)
      if (signal.aborted) return
      setState({
        notifications: data?.items ?? [],
        unreadCount: data?.unread_count ?? 0,
        isLoading: false,
        error: null,
      })
    } catch (err) {
      if (axios.isCancel(err) || signal.aborted) return
      setState({
        notifications: [],
        error: toApiError(err, 'Could not load your notifications'),
        isLoading: false,
      })
    } finally {
      inflight = null
    }
  })()

  return inflight
}

async function refreshUnreadCount() {
  try {
    const count = await notificationsApi.getUnreadCount()
    setState({ unreadCount: count })
  } catch {
    /* a dropped poll is not worth surfacing - the next one will do */
  }
}

function clearStore() {
  controller?.abort()
  setState({ notifications: [], unreadCount: 0, isLoading: false, error: null })
}

/* One interval no matter how many components are listening. */
let pollTimer = null
let pollers = 0

function startPolling() {
  pollers += 1
  if (pollTimer === null) {
    pollTimer = setInterval(refreshUnreadCount, POLL_INTERVAL_MS)
  }
}

function stopPolling() {
  pollers = Math.max(0, pollers - 1)
  if (pollers === 0 && pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

/**
 * Reads the shared notification store and exposes the mutations.
 *
 * Returns `{ notifications, unreadCount, isLoading, error, markRead,
 * markAllRead, deleteNotification, refresh }`.
 */
export function useNotifications({ poll = true } = {}) {
  const isAuthenticated = useAuthStore((store) => Boolean(store.user))
  const [snapshot, setSnapshot] = useState(state)

  useEffect(() => {
    listeners.add(setSnapshot)
    setSnapshot(state)
    return () => {
      listeners.delete(setSnapshot)
    }
  }, [])

  useEffect(() => {
    if (!isAuthenticated) {
      clearStore()
      return
    }
    void loadAll()
  }, [isAuthenticated])

  useEffect(() => {
    if (!poll || !isAuthenticated) return undefined
    startPolling()
    return stopPolling
  }, [poll, isAuthenticated])

  const refresh = useCallback(() => loadAll(), [])

  const markRead = useCallback(async (id) => {
    const target = state.notifications.find((item) => item.id === id)
    if (!target) return

    const wasUnread = !target.is_read

    // Optimistic: the badge should drop the moment the item is clicked.
    setState({
      notifications: state.notifications.map((item) =>
        item.id === id ? { ...item, is_read: true } : item,
      ),
      unreadCount: wasUnread ? Math.max(0, state.unreadCount - 1) : state.unreadCount,
    })

    try {
      await notificationsApi.markRead(id)
    } catch {
      // Put it back if the server disagreed.
      setState({
        notifications: state.notifications.map((item) =>
          item.id === id ? { ...item, is_read: false } : item,
        ),
        unreadCount: wasUnread ? state.unreadCount + 1 : state.unreadCount,
      })
    }
  }, [])

  const markAllRead = useCallback(async () => {
    const previous = { notifications: state.notifications, unreadCount: state.unreadCount }

    setState({
      notifications: state.notifications.map((item) => ({ ...item, is_read: true })),
      unreadCount: 0,
    })

    try {
      await notificationsApi.markAllRead()
    } catch (err) {
      setState(previous)
      throw err
    }
  }, [])

  const deleteNotification = useCallback(async (id) => {
    const previous = { notifications: state.notifications, unreadCount: state.unreadCount }
    const removed = previous.notifications.find((item) => item.id === id)

    setState({
      notifications: previous.notifications.filter((item) => item.id !== id),
      unreadCount:
        removed && !removed.is_read
          ? Math.max(0, previous.unreadCount - 1)
          : previous.unreadCount,
    })

    try {
      await notificationsApi.deleteNotification(id)
    } catch (err) {
      setState(previous)
      throw err
    }
  }, [])

  return {
    notifications: snapshot.notifications,
    unreadCount: snapshot.unreadCount,
    isLoading: snapshot.isLoading,
    error: snapshot.error,
    markRead,
    markAllRead,
    deleteNotification,
    refresh,
  }
}

export default useNotifications
