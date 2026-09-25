import { Capacitor } from '@capacitor/core'

/**
 * Whether this is the Android or iOS app rather than a browser.
 *
 * The app runs the same bundle as the portal, served from inside the app
 * (capacitor://localhost on iOS, https://localhost on Android), so the API is
 * on another origin and three things change:
 *
 *   the session travels in headers, not cookies - see supertokens.js;
 *   an <img> cannot authenticate itself - see hooks/useAuthedSrc.js;
 *   a file cannot be "downloaded" - see lib/saveFile.js.
 */
export const isNativeApp = Capacitor.isNativePlatform()
