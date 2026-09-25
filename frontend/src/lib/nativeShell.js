import { App as NativeApp } from '@capacitor/app'
import { SplashScreen } from '@capacitor/splash-screen'
import { StatusBar, Style } from '@capacitor/status-bar'

import { isNativeApp } from '@/lib/platform'

/**
 * Makes the app behave like an app on a phone. Does nothing in a browser.
 *
 *   Android's back button goes back a screen, and closes the app from the
 *   first one, instead of closing it from anywhere.
 *   The status bar matches the theme.
 *   The splash screen stays up until the first render, not a fixed time.
 */
export function initNativeShell() {
  if (!isNativeApp) return

  NativeApp.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back()
    else NativeApp.exitApp()
  })

  const dark = document.documentElement.classList.contains('dark')
  StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {})

  requestAnimationFrame(() => {
    SplashScreen.hide().catch(() => {})
  })
}
