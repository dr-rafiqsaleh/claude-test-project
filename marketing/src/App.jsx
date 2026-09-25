import { Route, Routes } from 'react-router-dom'

import { PageMeta } from '@/components/layout/PageMeta'
import { ScrollToTop } from '@/components/layout/ScrollToTop'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { SiteHeader } from '@/components/layout/SiteHeader'
import ContactPage from '@/pages/ContactPage'
import HomePage from '@/pages/HomePage'
import NotFoundPage from '@/pages/NotFoundPage'
import PrivacyPage from '@/pages/PrivacyPage'
import TermsPage from '@/pages/TermsPage'

/**
 * The website. Pages are imported directly rather than lazily: the prerender
 * step renders each one to HTML at build time, so a visitor gets the full page
 * before any JavaScript runs.
 */
export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <PageMeta />
      <ScrollToTop />
      <SiteHeader />
      <main id="main" className="flex-1">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
      <SiteFooter />
    </div>
  )
}
