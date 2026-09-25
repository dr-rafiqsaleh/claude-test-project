// The two SuperTokens base paths, in one place.
//
// They must match the backend's AUTH_API_BASE_PATH and AUTH_WEBSITE_BASE_PATH
// exactly. If they drift, the SDK calls a URL the server does not serve and
// every sign-in attempt 404s with nothing naming the cause.
//
// Why they differ from each other: both default to /auth in SuperTokens, which
// only works while the API and the portal are on separate origins. PestBase serves
// them from one origin - nginx proxies /api and /auth to the backend and lets
// everything else fall through to this app - so the SDK's POST
// /auth/signinup/code and the portal's own sign-in page would otherwise be the
// same URL, and no proxy can route one path to two places.
//
// The API keeps the conventional /auth; the sign-in page lives at /login.

export const AUTH_API_BASE_PATH = import.meta.env.VITE_AUTH_API_BASE_PATH || '/auth'

export const AUTH_WEBSITE_BASE_PATH = import.meta.env.VITE_AUTH_WEBSITE_BASE_PATH || '/login'

// Empty means "this origin", which is the normal case behind nginx. Set
// VITE_API_ORIGIN only when the API is served from somewhere else.
export const API_ORIGIN = import.meta.env.VITE_API_ORIGIN || ''
