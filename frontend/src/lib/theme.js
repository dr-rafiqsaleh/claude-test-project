/**
 * Light / dark / system theme. Light is the default; the choice is remembered
 * per browser. Applied before the first render (see main.jsx) so there is no flash.
 */
const STORAGE_KEY = 'pestbase-theme'

export const THEMES = ['light', 'dark', 'system']

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches

export function getTheme() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return THEMES.includes(stored) ? stored : 'light'
  } catch {
    return 'light'
  }
}

export function applyTheme(theme = getTheme()) {
  const dark = theme === 'dark' || (theme === 'system' && systemDark())
  document.documentElement.classList.toggle('dark', dark)
}

export function setTheme(theme) {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Storage can be blocked (private mode); the theme still applies for this visit.
  }
  applyTheme(theme)
}

/** Follow the operating system while the choice is "system". */
export function watchSystemTheme() {
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    if (getTheme() === 'system') applyTheme('system')
  }
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
