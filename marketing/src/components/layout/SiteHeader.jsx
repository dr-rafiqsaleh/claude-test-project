import { Link } from 'react-router-dom'

import { Logo } from '@/components/layout/Logo'
import { Button } from '@/components/ui/button'
import { SIGN_IN_URL } from '@/content/company'

const NAV = [
  { label: 'Features', to: '/#features' },
  { label: 'On site', to: '/#on-site' },
  { label: 'Security', to: '/#security' },
  { label: 'Contact', to: '/contact' },
]

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link to="/" aria-label="PestBase home" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Logo size={32} />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="hidden rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:inline-block"
            >
              {item.label}
            </Link>
          ))}
          <a
            href={SIGN_IN_URL}
            className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Sign in
          </a>
          <Button asChild size="sm">
            <Link to="/contact?topic=demo">Book a demo</Link>
          </Button>
        </nav>
      </div>
    </header>
  )
}
