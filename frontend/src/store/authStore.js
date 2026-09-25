import { create } from 'zustand'

/**
 * Who is signed in, and what they may do.
 *
 * No tokens live here any more. SuperTokens keeps the session in cookies and
 * refreshes it itself, so the only thing this holds is the PestBase profile behind
 * that session - the role, the client and the permissions the UI is drawn from.
 */
/** Where the chosen client is remembered across a page refresh. */
const WORKING_CLIENT_KEY = 'pestbase_working_client'

function readWorkingClient() {
  try {
    const raw = window.localStorage.getItem(WORKING_CLIENT_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export const useAuthStore = create((set, get) => ({
  user: null,
  status: 'idle',

  /**
   * The client PestBase staff are currently working inside, as {id, name}.
   *
   * Null means none chosen, which is the safe default: client records are
   * refused until one is. Sent as the X-Client-Id header on every request (see
   * lib/api.js), and every change made while it is set lands on that client's
   * audit trail.
   *
   * Ignored entirely for a client's own team - they are pinned to their own
   * client by the API whatever this says.
   */
  workingClient: readWorkingClient(),

  setWorkingClient: (client) => {
    try {
      if (client) {
        window.localStorage.setItem(WORKING_CLIENT_KEY, JSON.stringify(client))
      } else {
        window.localStorage.removeItem(WORKING_CLIENT_KEY)
      }
    } catch {
      /* private mode: it just will not survive a refresh */
    }
    set({ workingClient: client })
  },

  setUser: (user) => set({ user, status: user ? 'authenticated' : 'unauthenticated' }),

  setStatus: (status) => set({ status }),

  clear: () => {
    try {
      window.localStorage.removeItem(WORKING_CLIENT_KEY)
    } catch {
      /* nothing to clean up */
    }
    set({ user: null, status: 'unauthenticated', workingClient: null })
  },

  isAuthenticated: () => Boolean(get().user),

  hasRole: (...roles) => {
    const role = get().user?.role
    return role !== undefined && roles.includes(role)
  },

  /** PestBase's own staff, who manage the client companies. */
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
