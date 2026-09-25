import Session from 'supertokens-auth-react/recipe/session'

import api, { unwrap } from '@/lib/api'

/**
 * Signing in lives in the SuperTokens SDK, not here - see pages/auth/LoginPage.
 * What is left for the app is the profile behind the session, and ending it.
 */

/** GET /auth/me - the signed-in user, their role and their permissions. */
export async function getMe(signal) {
  const response = await api.get('/auth/me', { signal })
  return unwrap(response)
}

/** Whether a session exists at all, without asking the API. */
export async function hasSession() {
  return Session.doesSessionExist()
}

/** End this session. The SDK clears its cookies as part of this. */
export async function logout() {
  await Session.signOut()
}

/** End every session this account has, on every device. */
export async function logoutEverywhere() {
  await api.post('/auth/sign-out-everywhere')
  await Session.signOut()
}
