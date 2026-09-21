import api, { unwrap } from '@/lib/api'

/** POST /auth/login - exchange credentials for tokens. */
export async function login(credentials) {
  const response = await api.post('/auth/login', credentials)
  return unwrap(response)
}

/** POST /auth/refresh - exchange a refresh token for a new access token. */
export async function refresh(refreshToken) {
  const response = await api.post('/auth/refresh', { refresh_token: refreshToken })
  return unwrap(response).access_token
}

/** POST /auth/logout - invalidate the current session server-side. */
export async function logout() {
  await api.post('/auth/logout', {})
}

/** GET /auth/me - fetch the authenticated user's profile. */
export async function getMe() {
  const response = await api.get('/auth/me')
  return unwrap(response)
}
