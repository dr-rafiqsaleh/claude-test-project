import { useEffect, useState } from 'react'

import api from '@/lib/api'
import { isNativeApp } from '@/lib/platform'

/**
 * An `<img src>` for an API URL that needs the session.
 *
 * In a browser the portal and the API share an origin, the session cookie goes
 * with the image request by itself, and the URL is returned as it is. In the
 * app the session is a header an `<img>` cannot send, so the image is fetched
 * through the API client and shown from a blob URL instead.
 *
 * If that fetch fails the plain URL is returned, so the image's own onError
 * still fires and whatever fallback the page has still shows.
 */
export function useAuthedSrc(url) {
  const [src, setSrc] = useState(isNativeApp ? undefined : url)

  useEffect(() => {
    if (!isNativeApp || !url) {
      setSrc(url || undefined)
      return undefined
    }

    const controller = new AbortController()
    let objectUrl

    // Absolute: the API client's baseURL would otherwise be prefixed again.
    api
      .get(url, { baseURL: '', responseType: 'blob', signal: controller.signal })
      .then((response) => {
        objectUrl = URL.createObjectURL(response.data)
        setSrc(objectUrl)
      })
      .catch(() => {
        if (!controller.signal.aborted) setSrc(url)
      })

    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url])

  return src
}
