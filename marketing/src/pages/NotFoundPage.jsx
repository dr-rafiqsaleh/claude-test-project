import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { SIGN_IN_URL } from '@/content/company'

export default function NotFoundPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center sm:px-6">
      <h1 className="text-4xl font-bold tracking-tight">Page not found</h1>
      <p className="mt-4 text-muted-foreground">
        That page doesn&apos;t exist. Looking for the app?{' '}
        <a href={SIGN_IN_URL} className="font-medium text-primary underline underline-offset-4">
          Sign in here
        </a>
        .
      </p>
      <Button asChild className="mt-8">
        <Link to="/">Back to the home page</Link>
      </Button>
    </div>
  )
}
