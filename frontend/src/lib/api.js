import axios from 'axios'

import { API_ORIGIN } from '@/config/authPaths'
import { useAuthStore } from '@/store/authStore'

export const API_BASE_URL = `${API_ORIGIN}/api/v1`

/**
 * The API client.
 *
 * No Authorization header and no refresh logic: the session lives in cookies
 * that SuperTokens' `Session.init()` manages, and its interceptor on
 * XMLHttpRequest attaches them and silently refreshes an expiring session
 * underneath axios. `withCredentials` is what lets it.
 *
 * A 401 therefore means the session is genuinely gone - the refresh has already
 * been tried and failed - so the only thing left is to send them to sign in.
 */
export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
  timeout: 20000,
})

/**
 * PestBase staff say which client they are working inside; the API refuses client
 * records until they do. A client's own team never sets this - the API pins
 * them to their own client regardless of what the header says.
 */
api.interceptors.request.use((config) => {
  const working = useAuthStore.getState().workingClient
  if (working?.id) {
    config.headers.set('X-Client-Id', working.id)
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Clear the profile and let the router notice. Deliberately NOT a
      // `window.location.assign('/login')`, which this used to do: a hard
      // navigation tears the page down mid-flight, so one unlucky 401 - during
      // sign-in, or from a background poll - threw away the sign-in that was
      // half-finished and landed the person back on the sign-in page with no
      // idea why. Clearing the store lets ProtectedRoute redirect on the next
      // render, and lets whoever made the call see the error and say something.
      useAuthStore.getState().clear()
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
      message = 'Cannot reach the PestBase server. Check that the API is running.'
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
