import { Link } from 'react-router-dom'
import { AlertCircle, ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Page-level building blocks shared by every screen, so headings, empty lists,
 * errors and paging look and behave the same everywhere.
 */

/** Title row: optional back link, title with a status badge, description, actions. */
export function PageHeader({ title, description, badge, actions, backTo, backLabel, className }) {
  return (
    <div className={cn('space-y-3', className)}>
      {backTo ? (
        <Link
          to={backTo}
          className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" />
          {backLabel}
        </Link>
      ) : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
            {badge}
          </div>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2 sm:justify-end">{actions}</div> : null}
      </div>
    </div>
  )
}

/** A labelled value on a detail page. `href` for tel:/mailto: links, `to` for in-app ones. */
export function DetailField({ icon: Icon, label, value, href, to }) {
  const linkClass = 'break-words text-sm font-medium text-primary hover:underline'
  const empty = value === null || value === undefined || value === '' || value === '--'

  let content = <p className="break-words text-sm font-medium text-foreground">{empty ? '--' : value}</p>
  if (!empty && to) {
    content = (
      <Link to={to} className={linkClass}>
        {value}
      </Link>
    )
  } else if (!empty && href) {
    content = (
      <a href={href} className={linkClass}>
        {value}
      </a>
    )
  }

  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {content}
      </div>
    </div>
  )
}

/** Shown in place of a list with nothing in it. */
export function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-16 text-center', className)}>
      {Icon ? (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Icon className="h-6 w-6 text-muted-foreground/70" />
        </div>
      ) : null}
      <div>
        <p className="font-medium text-foreground">{title}</p>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

/** Shown when something failed to load, with a retry. */
export function ErrorState({ title, message, onRetry, className }) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-16 text-center', className)}>
      <AlertCircle className="h-10 w-10 text-destructive" />
      <div>
        <p className="font-medium text-foreground">{title}</p>
        {message ? <p className="mt-1 text-sm text-muted-foreground">{message}</p> : null}
      </div>
      {onRetry ? (
        <Button variant="outline" onClick={() => void onRetry()}>
          Try again
        </Button>
      ) : null}
    </div>
  )
}

/** "Showing 1-20 of 42" with previous/next, for the foot of a paged list. */
export function Pagination({ page, totalPages, total, pageSize, onPageChange }) {
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = Math.min(page * pageSize, total)

  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-border px-4 py-3 sm:flex-row">
      <p className="text-sm text-muted-foreground">
        Showing <span className="font-medium">{rangeStart}</span>-
        <span className="font-medium">{rangeEnd}</span> of <span className="font-medium">{total}</span>
      </p>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>
        <span className="px-2 text-sm text-muted-foreground">
          Page {page} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
