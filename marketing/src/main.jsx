import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from '@/App'
import '@/index.css'

const root = document.getElementById('root')
const app = (
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)

// A built page arrives already rendered (see scripts/prerender.mjs): take it
// over rather than drawing it again. `npm run dev` serves an empty shell.
if (root.hasChildNodes()) {
  ReactDOM.hydrateRoot(root, app)
} else {
  ReactDOM.createRoot(root).render(app)
}
