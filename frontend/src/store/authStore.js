import { create } from 'zustand'

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

  /** QKil's own staff, who manage the client companies. */
  isPlatformStaff: () => Boolean(get().user?.is_platform_staff),

  /** Whether the signed-in user's role holds a permission. */
  can: (permission) => Boolean(get().user?.permissions?.includes(permission)),

  // ponytail: canWrite is the union the old Office Staff role stood for, so
  // every existing call site keeps working. Swap a call site for the exact
  // can('quotes.edit') / can('invoices.edit') etc. when a custom role needs
  // finer control than "can change records at all".
  canWrite: () =>
    ['customers.edit', 'quotes.edit', 'jobs.edit', 'invoices.edit'].some((permission) =>
      get().can(permission),
    ),

  isAdmin: () => get().can('settings.manage'),
}))
