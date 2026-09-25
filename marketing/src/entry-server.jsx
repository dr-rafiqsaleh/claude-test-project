import React from 'react'
import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'

import App from '@/App'

/** One page as HTML, for the prerender step. */
export function render(url) {
  return renderToString(
    <React.StrictMode>
      <StaticRouter location={url}>
        <App />
      </StaticRouter>
    </React.StrictMode>,
  )
}

export { PAGES } from '@/routes'
export { SITE_URL } from '@/content/company'
