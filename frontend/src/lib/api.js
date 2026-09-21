import axios from 'axios'

import { clearRefreshToken, readRefreshToken, useAuthStore } from '@/store/authStore'

export const API_BASE_URL = '/api/v1'

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 20000,
})

/** Bare client used for the refresh call so interceptors cannot recurse. */
const refreshClient = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 20000,
})

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`)
  }
  return config
})

let refreshPromise = null

/** Exchange the stored refresh token for a new access token. */
export async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    const refreshToken = readRefreshToken()
    if (!refreshToken) return null

    try {
      const response = await refreshClient.post('/auth/refresh', { refresh_token: refreshToken })
      const accessToken = response.data.data.access_token
      useAuthStore.getState().setAccessToken(accessToken)
      return accessToken
    } catch {
      clearRefreshToken()
      return null
    } finally {
      refreshPromise = null
    }
  })()

  return refreshPromise
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config

    const isAuthEndpoint =
      typeof original?.url === 'string' &&
      (original.url.includes('/auth/login') || original.url.includes('/auth/refresh'))

    if (
      error.response?.status === 401 &&
      original &&
      !original._retry &&
      !original._skipAuthRefresh &&
      !isAuthEndpoint
    ) {
      original._retry = true

      const newToken = await refreshAccessToken()
      if (newToken) {
        original.headers.set('Authorization', `Bearer ${newToken}`)
        return api(original)
      }

      useAuthStore.getState().logout()
    }

    return Promise.reject(error)
  },
)

/** Normalise any thrown value into a predictable error object. */
export function toApiError(error, fallback = 'Something went wrong') {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data
    const fieldErrors = body?.data?.errors

    let message = body?.message || body?.detail || error.message || fallback
    if (error.code === 'ECONNABORTED') {
      message = 'The request timed out. Please try again.'
    } else if (!error.response) {
      message = 'Cannot reach the QKil server. Check that the API is running.'
    }

    return {
      message,
      status: error.response?.status,
      fieldErrors: fieldErrors && fieldErrors.length > 0 ? fieldErrors : undefined,
    }
  }

  if (error instanceof Error) {
    return { message: error.message || fallback }
  }

  return { message: fallback }
}

/** Unwrap the `data` field from the standard API envelope. */
export function unwrap(response) {
  return response.data.data
}

export default api
