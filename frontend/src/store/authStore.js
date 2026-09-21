import { create } from 'zustand'

import { UserRole } from '@/lib/constants'

/** localStorage key holding the long-lived refresh token. */
export const REFRESH_TOKEN_KEY = 'qkil_refresh'

export function readRefreshToken() {
  try {
    return window.localStorage.getItem(REFRESH_TOKEN_KEY)
  } catch {
    return null
  }
}

export function writeRefreshToken(token) {
  try {
    window.localStorage.setItem(REFRESH_TOKEN_KEY, token)
  } catch {
    /* storage unavailable (private mode) - session stays in memory only */
  }
}

export function clearRefreshToken() {
  try {
    window.localStorage.removeItem(REFRESH_TOKEN_KEY)
  } catch {
    /* nothing to clean up */
  }
}

export const useAuthStore = create((set, get) => ({
  user: null,
  /** Access token is intentionally kept in memory only. */
  accessToken: null,
  status: 'idle',

  setAuth: (user, accessToken, refreshToken) => {
    if (refreshToken) writeRefreshToken(refreshToken)
    set({ user, accessToken, status: 'authenticated' })
  },

  setAccessToken: (accessToken) => set({ accessToken }),

  setUser: (user) => set({ user }),

  setStatus: (status) => set({ status }),

  logout: () => {
    clearRefreshToken()
    set({ user: null, accessToken: null, status: 'unauthenticated' })
  },

  isAuthenticated: () => Boolean(get().accessToken && get().user),

  hasRole: (...roles) => {
    const role = get().user?.role
    return role !== undefined && roles.includes(role)
  },

  canWrite: () => {
    const role = get().user?.role
    return role === UserRole.ADMIN || role === UserRole.OFFICE_STAFF
  },

  isAdmin: () => get().user?.role === UserRole.ADMIN,
}))
