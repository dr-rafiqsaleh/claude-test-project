import { useEffect, useState } from 'react'

import { getSettings } from '@/api/settings'

// Settings change rarely, so every screen shares one request per session.
let cached = null
let request = null

/** Replace the shared copy after the settings are saved, so screens see the change. */
export function primeCompanySettings(settings) {
  cached = settings
  request = null
}

/**
 * The company settings, loaded once and shared: the product list, report
 * wording and branding. `null` until loaded, and stays `null` if the request
 * fails - callers treat that as "no products yet".
 */
export function useCompanySettings() {
  const [settings, setSettings] = useState(cached)

  useEffect(() => {
    if (cached) {
      setSettings(cached)
      return undefined
    }
    let active = true
    request ??= getSettings()
      .then((data) => {
        cached = data
        return data
      })
      .catch(() => {
        request = null // let the next screen try again
        return null
      })
    void request.then((data) => {
      if (active) setSettings(data)
    })
    return () => {
      active = false
    }
  }, [])

  return settings
}
