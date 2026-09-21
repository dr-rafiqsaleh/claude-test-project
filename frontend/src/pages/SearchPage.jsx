import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowRight,
  Search,
  SearchX,
} from 'lucide-react'

import { SearchResultIconChip } from '@/components/search/SearchResultIcon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useSearch, MIN_QUERY_LENGTH } from '@/hooks/useSearch'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import {
  SEARCH_STATUS_BADGE,
  SEARCH_TYPE_LABELS,
  SEARCH_TYPES,
  UserRole,
} from '@/lib/constants'

/** Results per collection on the full page - deeper than the header dropdown. */
const PAGE_LIMIT = 20

const ALL = 'all'

function StatusBadge({ status }) {
  if (!status) return null
  return (
    <Badge variant={SEARCH_STATUS_BADGE[status] ?? 'secondary'} className="shrink-0 capitalize">
      {String(status).replace(/_/g, ' ')}
    </Badge>
  )
}

function ResultRow({ item }) {
  return (
    <Link
      to={item.url}
      className="group flex items-center gap-3 border-b border-border px-4 py-3 transition-colors last:border-b-0 hover:bg-muted/50"
    >
      <SearchResultIconChip type={item.type} />

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">{item.title}</p>
        {item.subtitle ? (
          <p className="truncate text-sm text-muted-foreground">{item.subtitle}</p>
        ) : null}
      </div>

      <StatusBadge status={item.status} />

      <span className="hidden shrink-0 items-center gap-1 text-sm font-medium text-primary group-hover:underline sm:flex">
        View
        <ArrowRight className="h-3.5 w-3.5" />
      </span>
    </Link>
  )
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <div className="h-9 w-9 shrink-0 animate-pulse rounded-md bg-muted" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
      </div>
      <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      {[0, 1].map((group) => (
        <Card key={group} className="overflow-hidden">
          <div className="border-b border-border px-4 py-3">
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
          </div>
          {[0, 1, 2].map((row) => (
            <SkeletonRow key={row} />
          ))}
        </Card>
      ))}
    </div>
  )
}

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const isTechnician = useAuthStore((state) => state.user?.role === UserRole.TECHNICIAN)

  const urlQuery = searchParams.get('q') ?? ''
  const [typeFilter, setTypeFilter] = useState(ALL)

  // Technicians never see invoices anywhere in QKil, so the tab is hidden too.
  const availableTypes = useMemo(
    () => (isTechnician ? SEARCH_TYPES.filter((type) => type !== 'invoices') : SEARCH_TYPES),
    [isTechnician],
  )

  const requestedTypes = typeFilter === ALL ? availableTypes : [typeFilter]

  const { query, setQuery, results, totalCount, isLoading, error, retry } = useSearch({
    limit: PAGE_LIMIT,
    types: requestedTypes,
    initialQuery: urlQuery,
  })

  // The URL is the source of truth on load and on back/forward navigation.
  useEffect(() => {
    setQuery(urlQuery)
  }, [urlQuery, setQuery])

  function submit(event) {
    event.preventDefault()
    const term = query.trim()
    setSearchParams(term ? { q: term } : {}, { replace: true })
  }

  const trimmed = query.trim()
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_QUERY_LENGTH
  const groups = availableTypes.filter((type) => (results[type] ?? []).length > 0)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Search"
        description={
          <>
            Look across customers, quotes, visits, reports{isTechnician ? '' : ' and invoices'} in one
            place.
          </>
        }
      />

      <Card>
        <CardContent className="space-y-4 p-4">
          <form onSubmit={submit}>
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground/70" />
              <Input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search customers, visits, invoices..."
                aria-label="Search QKil"
                className="h-12 pl-12 text-base"
              />
            </div>
          </form>

          <div className="flex flex-wrap gap-2">
            {[ALL, ...availableTypes].map((type) => {
              const isActive = typeFilter === type
              const count = type === ALL ? totalCount : (results[type] ?? []).length

              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setTypeFilter(type)}
                  aria-pressed={isActive}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input bg-card text-foreground hover:bg-muted/50 dark:bg-transparent',
                  )}
                >
                  {type === ALL ? 'All' : SEARCH_TYPE_LABELS[type]}
                  {trimmed.length >= MIN_QUERY_LENGTH && count > 0 ? (
                    <span className={cn('ml-1.5', isActive ? 'text-primary-foreground/80' : 'text-muted-foreground/70')}>
                      {count}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {tooShort ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Search className="h-6 w-6 text-muted-foreground/70" />
            </div>
            <p className="text-sm text-muted-foreground">
              Type at least {MIN_QUERY_LENGTH} characters to search.
            </p>
          </CardContent>
        </Card>
      ) : trimmed.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Search className="h-6 w-6 text-muted-foreground/70" />
            </div>
            <div>
              <p className="font-medium text-foreground">
                Start typing to search
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Try a customer name, a phone number, or a record number like INV-0001.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <LoadingSkeleton />
      ) : error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <div>
              <p className="font-medium text-foreground">Search failed</p>
              <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
            </div>
            <Button variant="outline" onClick={retry}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              <SearchX className="h-7 w-7 text-muted-foreground/70" />
            </div>
            <div>
              <p className="font-medium text-foreground">
                No results for &ldquo;{trimmed}&rdquo;
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Check the spelling, or try a shorter search term.
              </p>
            </div>
            {typeFilter !== ALL ? (
              <Button variant="outline" onClick={() => setTypeFilter(ALL)}>
                Search everything
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{totalCount}</span>{' '}
            result{totalCount === 1 ? '' : 's'} for &ldquo;{trimmed}&rdquo;
          </p>

          {groups.map((type) => (
            <Card key={type} className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-foreground">
                  {SEARCH_TYPE_LABELS[type]} ({results[type].length})
                </h2>
              </div>
              {results[type].map((item) => (
                <ResultRow key={`${item.type}-${item.id}`} item={item} />
              ))}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

export default SearchPage
