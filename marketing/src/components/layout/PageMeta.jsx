import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

import { PAGES } from '@/routes'

/**
 * Keeps the tab title and description right after moving between pages.
 *
 * The first load already has them: the prerender step writes each page's own
 * into its HTML. This only matters for navigation inside the browser.
 */
export function PageMeta() {
  const { pathname } = useLocation()

  useEffect(() => {
    const page = PAGES[pathname] ?? PAGES['/404']
    document.title = page.title
    document.querySelector('meta[name="description"]')?.setAttribute('content', page.description)
  }, [pathname])

  return null
}
