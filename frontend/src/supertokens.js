import SuperTokens from 'supertokens-auth-react'
import Passwordless from 'supertokens-auth-react/recipe/passwordless'
import Session from 'supertokens-auth-react/recipe/session'

import { API_ORIGIN, AUTH_API_BASE_PATH, AUTH_WEBSITE_BASE_PATH } from '@/config/authPaths'
import { isNativeApp } from '@/lib/platform'

/**
 * Sign-in, without passwords.
 *
 * Somebody types their email address, PestBase sends a link and a six-digit code,
 * and either one signs them in. The session lives in cookies the SDK manages -
 * nothing here stores a token, and nothing needs to refresh one.
 *
 * `Session.init()` also installs an interceptor on fetch and XMLHttpRequest, so
 * the axios client in lib/api.js gets the session and the silent refresh for
 * free.
 *
 * The Android and iOS apps are the exception. They load this bundle from inside
 * the app, so the API is on another origin, where a phone's web view drops the
 * session cookies as third-party. There the SDK keeps the tokens itself and
 * sends them as headers instead - the same interceptor, the same refresh.
 */
export function initSuperTokens() {
  SuperTokens.init({
    appInfo: {
      appName: 'PestBase',
      // Same origin as the portal: nginx proxies /auth to the backend, which
      // keeps the session cookies first-party.
      apiDomain: API_ORIGIN || window.location.origin,
      websiteDomain: window.location.origin,
      apiBasePath: AUTH_API_BASE_PATH,
      websiteBasePath: AUTH_WEBSITE_BASE_PATH,
    },
    recipeList: [
      Session.init(isNativeApp ? { tokenTransferMethod: 'header' } : undefined),
      Passwordless.init({
        contactMethod: 'EMAIL',
        // A code as well as a link: a technician who cannot open a link on a
        // site phone can read six digits off the screen and type them.
        getRedirectionURL: async (context) => {
          if (context.action !== 'SUCCESS') return undefined
          // The index route sends them on: a client's team to the dashboard,
          // PestBase's own staff to the client list.
          return '/'
        },
      }),
    ],
  })
}

export { Passwordless, Session }
