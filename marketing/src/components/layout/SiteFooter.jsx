import { Link } from 'react-router-dom'

import { COMPANY, SIGN_IN_URL } from '@/content/company'

/**
 * The footer on every page, carrying the company details UK law requires a
 * company's website to show: its name, number, place of registration and
 * registered office. They come from content/company.js.
 */
export function SiteFooter() {
  const linkClass = 'text-muted-foreground underline-offset-4 hover:text-foreground hover:underline'

  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1 text-muted-foreground">
          <p>
            © {new Date().getFullYear()} {COMPANY.displayName}, trading as {COMPANY.tradingName}
          </p>
          <p className="text-xs">
            Registered in {COMPANY.registeredIn}, company number {COMPANY.number}. Registered office:{' '}
            {COMPANY.registeredOffice}.
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2 md:shrink-0">
          <Link to="/privacy" className={linkClass}>
            Privacy policy
          </Link>
          <Link to="/terms" className={linkClass}>
            Terms
          </Link>
          <Link to="/contact" className={linkClass}>
            Contact us
          </Link>
          <a href={SIGN_IN_URL} className={linkClass}>
            Sign in
          </a>
        </nav>
      </div>
    </footer>
  )
}
