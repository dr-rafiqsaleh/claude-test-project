import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from '@/App'
import { initNativeShell } from '@/lib/nativeShell'
import { applyTheme, watchSystemTheme } from '@/lib/theme'
import { initSuperTokens } from '@/supertokens'
import '@/index.css'

// Before the first render, so a dark-theme user never sees a white flash.
applyTheme()
watchSystemTheme()

// Before the first render too: Session.init() installs the interceptor that
// attaches the session to every request and refreshes it when it is close to
// expiring, so anything that fetches before this would go out unauthenticated.
initSuperTokens()

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

initNativeShell()
