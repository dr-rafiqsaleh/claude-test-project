import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * A new page starts at the top, unless the link points at a section of it.
 *
 * Keyboard focus moves back to the top too, as it would on a full page load:
 * otherwise it stays where the clicked link was, and the next Tab lands in the
 * middle of the new page rather than on "Skip to content".
 */
export function ScrollToTop() {
  const { pathname, hash } = useLocation()
  const firstRender = useRef(true)

  useEffect(() => {
    if (hash) {
      document.getElementById(hash.slice(1))?.scrollIntoView()
    } else {
      window.scrollTo(0, 0)
    }
  }, [pathname, hash])

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    document.getElementById('top')?.focus({ preventScroll: true })
  }, [pathname])

  return null
}
