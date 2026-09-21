import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Clock, Search, X } from 'lucide-react'

import { SearchResultIconChip } from '@/components/search/SearchResultIcon'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useSearch, MIN_QUERY_LENGTH } from '@/hooks/useSearch'
import { cn } from '@/lib/utils'
import {
  MAX_RECENT_SEARCHES,
  RECENT_SEARCHES_KEY,
  SEARCH_TYPE_LABELS,
  SEARCH_TYPES,
} from '@/lib/constants'

/** Results per collection inside the dropdown - deliberately shallow. */
const DROPDOWN_LIMIT = 3

function readRecentSearches() {
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []
  } catch {
    return []
  }
}

function writeRecentSearches(terms) {
  try {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(terms))
  } catch {
    /* storage unavailable (private mode) - recent searches are a nicety */
  }
}

/**
 * The header quick-search: an instant dropdown of results, a memory of the
 * last few searches, and Enter to open the full results page.
 */
export function HeaderSearch({ className, autoFocus = false, onDismiss }) {
  const navigate = useNavigate()
  const containerRef = useRef(null)
  const inputRef = useRef(null)

  const [open, setOpen] = useState(false)
  const [recent, setRecent] = useState(() => readRecentSearches())

  const { query, setQuery, results, totalCount, isLoading } = useSearch({
    limit: DROPDOWN_LIMIT,
  })

  const trimmed = query.trim()
  const isSearching = trimmed.length >= MIN_QUERY_LENGTH

  const groups = useMemo(
    () => SEARCH_TYPES.filter((type) => (results[type] ?? []).length > 0),
    [results],
  )

  // Close on any click that lands outside the search box.
  useEffect(() => {
    if (!open) return undefined

    function handlePointerDown(event) {
      if (!containerRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
    }
  }, [open])

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  const remember = useCallback((term) => {
    const cleaned = term.trim()
    if (cleaned.length < MIN_QUERY_LENGTH) return

    setRecent((current) => {
      const next = [cleaned, ...current.filter((item) => item !== cleaned)].slice(
        0,
        MAX_RECENT_SEARCHES,
      )
      writeRecentSearches(next)
      return next
    })
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    onDismiss?.()
  }, [onDismiss])

  function goToResults(term = trimmed) {
    const cleaned = term.trim()
    if (cleaned.length < MIN_QUERY_LENGTH) return
    remember(cleaned)
    close()
    navigate(`/search?q=${encodeURIComponent(cleaned)}`)
  }

  function openResult(item) {
    remember(trimmed)
    close()
    navigate(item.url)
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter') {
      event.preventDefault()
      goToResults()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      if (query) {
        setQuery('')
      } else {
        close()
      }
    }
  }

  function clearRecent() {
    setRecent([])
    writeRecentSearches([])
  }

  const showRecent = open && !isSearching && recent.length > 0
  const showResults = open && isSearching

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
      <Input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Search customers, jobs, invoices..."
        aria-label="Search QKil"
        role="combobox"
        aria-expanded={showRecent || showResults}
        aria-controls="header-search-results"
        className="pl-9 pr-9"
      />

      {query ? (
        <button
          type="button"
          onClick={() => {
            setQuery('')
            inputRef.current?.focus()
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground/70 hover:bg-muted hover:text-muted-foreground"
          aria-label="Clear search"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}

      {showRecent || showResults ? (
        <div
          id="header-search-results"
          className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[26rem] overflow-y-auto rounded-lg border border-border bg-card shadow-lg"
        >
          {showRecent ? (
            <>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
                  Recent searches
                </span>
                <button
                  type="button"
                  onClick={clearRecent}
                  className="text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              </div>
              {recent.map((term) => (
                <button
                  key={term}
                  type="button"
                  onClick={() => goToResults(term)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted/50"
                >
                  <Clock className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                  <span className="truncate">{term}</span>
                </button>
              ))}
            </>
          ) : null}

          {showResults ? (
            isLoading ? (
              <div className="flex items-center gap-3 px-3 py-6 text-sm text-muted-foreground">
                <Spinner size="sm" />
                Searching...
              </div>
            ) : groups.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                No results for &ldquo;{trimmed}&rdquo;
              </div>
            ) : (
              <>
                {groups.map((type) => (
                  <div key={type} className="border-b border-border last:border-b-0">
                    <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
                      {SEARCH_TYPE_LABELS[type]}
                    </p>
                    {results[type].map((item) => (
                      <button
                        key={`${item.type}-${item.id}`}
                        type="button"
                        onClick={() => openResult(item)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/50"
                      >
                        <SearchResultIconChip type={item.type} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">
                            {item.title}
                          </span>
                          {item.subtitle ? (
                            <span className="block truncate text-xs text-muted-foreground">
                              {item.subtitle}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => goToResults()}
                  className="flex w-full items-center justify-between gap-2 border-t border-border px-3 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
                >
                  <span className="truncate">
                    See all {totalCount} result{totalCount === 1 ? '' : 's'} for &ldquo;{trimmed}
                    &rdquo;
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0" />
                </button>
              </>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default HeaderSearch
