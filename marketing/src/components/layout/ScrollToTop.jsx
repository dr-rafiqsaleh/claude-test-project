import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/** A new page starts at the top, unless the link points at a section of it. */
export function ScrollToTop() {
  const { pathname, hash } = useLocation()

  useEffect(() => {
    if (hash) {
      document.getElementById(hash.slice(1))?.scrollIntoView()
    } else {
      window.scrollTo(0, 0)
    }
  }, [pathname, hash])

  return null
}
