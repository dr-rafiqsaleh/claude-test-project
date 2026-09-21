import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from '@/App'
import { applyTheme, watchSystemTheme } from '@/lib/theme'
import '@/index.css'

// Before the first render, so a dark-theme user never sees a white flash.
applyTheme()
watchSystemTheme()

const container = document.getElementById('root')

if (!container) {
  throw new Error('Root element #root was not found in index.html')
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
