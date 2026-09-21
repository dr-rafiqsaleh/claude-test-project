import api, { unwrap } from '@/lib/api'

/** GET /notifications - the current user's notifications, newest first. */
export async function getNotifications(unreadOnly = false, limit = 50, signal) {
  const response = await api.get('/notifications', {
    params: { unread_only: unreadOnly, limit },
    signal,
  })
  return unwrap(response)
}

/** GET /notifications/unread-count - just the badge number. */
export async function getUnreadCount(signal) {
  const response = await api.get('/notifications/unread-count', { signal })
  return unwrap(response)?.count ?? 0
}

/** PATCH /notifications/{id}/read */
export async function markRead(id) {
  const response = await api.patch(`/notifications/${id}/read`)
  return unwrap(response)
}

/** PATCH /notifications/read-all */
export async function markAllRead() {
  const response = await api.patch('/notifications/read-all')
  return unwrap(response)
}

/** DELETE /notifications/{id} */
export async function deleteNotification(id) {
  const response = await api.delete(`/notifications/${id}`)
  return unwrap(response)
}
