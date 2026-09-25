import { APP_URL } from '@/content/company'

/**
 * The one call the website makes: sending the contact form to the PestBase API.
 *
 * The API is served by the app, so a built site posts to APP_URL unless
 * VITE_API_ORIGIN says otherwise (a staging API, say). `npm run dev` posts to
 * its own origin, which vite.config.js proxies to the backend on :8000.
 */
// `||`, not `??`: the Dockerfile passes an unset build arg as an empty string.
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN || (import.meta.env.DEV ? '' : APP_URL)).replace(/\/$/, '')

export class ApiError extends Error {
  constructor(message, fieldErrors) {
    super(message)
    this.fieldErrors = fieldErrors
  }
}

/** POST /api/v1/contact. Resolves on success, throws an ApiError otherwise. */
export async function sendEnquiry(data) {
  let response
  try {
    response = await fetch(`${API_ORIGIN}/api/v1/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  } catch {
    throw new ApiError("We couldn't reach PestBase just now. Please check your connection and try again.")
  }

  const body = await response.json().catch(() => null)
  if (!response.ok || body?.success === false) {
    throw new ApiError(
      body?.message || 'Something went wrong sending your message. Please try again.',
      body?.data?.errors,
    )
  }
  return body
}
