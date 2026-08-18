'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { localizePath } from '@/i18n/locale-preference'
import { useFilterParams } from '@/hooks/use-filter-params'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import {
  trackSearchExecuted,
  trackSearchResultClicked,
  trackSearchSuggestionSelect,
} from '@/lib/analytics'
import type { SearchSuggestion } from '@/lib/brands/contracts'
import {
  SearchSuggestions,
  searchSuggestionOptionId,
} from './search-suggestions'

interface SearchInputProps {
  redirectTo?: string
  placeholder?: string
  className?: string
  formAriaLabel?: string
  showAutocomplete?: boolean
  announceLoading?: boolean
}

function SearchInput({
  redirectTo,
  placeholder,
  className,
  formAriaLabel,
  showAutocomplete = true,
  announceLoading = true,
}: SearchInputProps = {}) {
  const t = useTranslations('brands')
  const locale = useLocale()
  const { filters, isPending, setSearch } = useFilterParams()
  const [value, setValue] = useState(filters.search)
  const [lastUrlSearch, setLastUrlSearch] = useState(filters.search)
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([])
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [showDropdown, setShowDropdown] = useState(false)
  const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputVersionRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const containerRef = useRef<HTMLFormElement>(null)
  const router = useRouter()
  // Per-instance, not a module constant: the homepage renders this field twice
  // at `md+` (hero and nav), and one shared listbox id pointed `aria-controls`
  // at whichever list happened to be first in the DOM.
  const suggestionsId = useId()

  if (filters.search !== lastUrlSearch) {
    setLastUrlSearch(filters.search)
    setValue(filters.search)
  }

  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setSuggestions([])
      setShowDropdown(false)
      setIsFetchingSuggestions(false)
      return
    }

    const inputVersion = inputVersionRef.current

    try {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      })
      if (inputVersion !== inputVersionRef.current) return
      if (!res.ok) {
        setSuggestions([])
        setShowDropdown(false)
        setSelectedIndex(-1)
        setIsFetchingSuggestions(false)
        return
      }

      const data = await res.json()
      if (inputVersion !== inputVersionRef.current) return
      const results = data.results ?? []
      setSuggestions(results)
      setShowDropdown(true)
      setSelectedIndex(-1)
      setIsFetchingSuggestions(false)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      if (inputVersion !== inputVersionRef.current) return
      setSuggestions([])
      setShowDropdown(false)
      setSelectedIndex(-1)
      setIsFetchingSuggestions(false)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    debounceRef.current = setTimeout(() => {
      if (!redirectTo) {
        setSearch(value)
      }
      if (value.trim().length < 2) {
        setSuggestions([])
        setShowDropdown(false)
        setIsFetchingSuggestions(false)
      } else if (showAutocomplete) {
        setIsFetchingSuggestions(true)
        fetchSuggestions(value)
      } else {
        setSuggestions([])
        setShowDropdown(false)
        setIsFetchingSuggestions(false)
      }
    }, 200)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [fetchSuggestions, redirectTo, setSearch, showAutocomplete, value])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => () => {
    abortRef.current?.abort()
  }, [])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    inputVersionRef.current += 1
    setValue(e.target.value)
    setIsFetchingSuggestions(showAutocomplete && e.target.value.trim().length >= 2)
  }

  function handleClear() {
    abortRef.current?.abort()
    inputVersionRef.current += 1
    setValue('')
    if (!redirectTo) {
      setSearch('')
    }
    setSuggestions([])
    setShowDropdown(false)
    setIsFetchingSuggestions(false)
  }

  function handleSelect(slug: string, index: number) {
    const selected = suggestions[index]
    // Only the instance that does NOT drive a results page counts the search here.
    // With `redirectTo` set (the header box on another page) the URL is never rewritten
    // with the query, so picking a suggestion jumps straight to the brand and nothing
    // else would count it; `suggestions.length` is what was on screen, so it is honest.
    // Without `redirectTo` the box rewrites the URL as you type and SearchResultsTracker
    // already emits the true total — emitting again would double-count one search with
    // two incompatible counts (DEV-1412).
    if (redirectTo) {
      trackSearchExecuted(value, suggestions.length)
    }
    trackSearchResultClicked(value, index, selected?.id, slug)
    trackSearchSuggestionSelect(slug, selected?.id)
    setShowDropdown(false)
    router.push(`/brands/${slug}`)
  }

  function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (selectedIndex >= 0 && suggestions[selectedIndex]) {
      handleSelect(suggestions[selectedIndex].slug, selectedIndex)
      return
    }
    const q = (new FormData(e.currentTarget).get('q') as string)?.trim() ?? ''
    if (q) {
      // No search event here. This form only knows `suggestions` — the typeahead's
      // list, which answers a different query, caps at 5, and is still empty inside
      // the 200ms debounce. SearchResultsTracker emits from the results page, where
      // the real total is known (DEV-1412).
      if (redirectTo) {
        // Use native navigation for cross-page redirects — router.push
        // intermittently fails in WebKit when navigating from / to /brands.
        window.location.href = `${localizePath(redirectTo, locale)}?search=${encodeURIComponent(q)}`
      }
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!showDropdown && value.trim()) {
        setShowDropdown(true)
        return
      }
      setSelectedIndex((prev) => Math.min(prev + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, -1))
    } else if (e.key === 'Enter' && selectedIndex >= 0 && suggestions[selectedIndex]) {
      e.preventDefault()
      handleSelect(suggestions[selectedIndex].slug, selectedIndex)
    } else if (e.key === 'Escape') {
      setShowDropdown(false)
      setSelectedIndex(-1)
    }
  }

  const isBusy = isPending || isFetchingSuggestions

  return (
    <form
      ref={containerRef}
      role="search"
      aria-label={formAriaLabel ?? t('search.aria')}
      aria-busy={isBusy}
      onSubmit={handleSubmit}
      className={cn('relative w-full max-w-md', className)}
      data-ph-no-autocapture
    >
      {announceLoading ? (
        <span className="sr-only" role="status" aria-live="polite">
          {isBusy ? t('search.loading') : ''}
        </span>
      ) : null}

      {/* Search icon */}
      {isBusy ? (
        <Loader2
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground"
          aria-hidden="true"
        />
      ) : (
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
          />
        </svg>
      )}

      <Input
        name="q"
        type="text"
        role="searchbox"
        aria-label={t('search.aria')}
        aria-autocomplete="list"
        aria-controls={showDropdown ? suggestionsId : undefined}
        aria-activedescendant={
          showDropdown && selectedIndex >= 0 && suggestions[selectedIndex]
            ? searchSuggestionOptionId(
                suggestionsId,
                suggestions[selectedIndex].id,
              )
            : undefined
        }
        placeholder={placeholder ?? t('search.placeholder')}
        maxLength={100}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className="w-full pl-9 pr-8"
      />

      {/* Clear button */}
      {value && (
        <button
          type="button"
          onClick={handleClear}
          aria-label={t('search.clear')}
          // eslint-disable-next-line no-restricted-syntax -- ui-exception: inline clear button inside custom search form, tightly coupled to search input layout
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:text-foreground"
        >
          <svg
            className="h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      {/* Hidden submit button ensures implicit form submission works in all browsers (WebKit) */}
      <button type="submit" hidden aria-hidden="true" tabIndex={-1} />

      {showDropdown && (
        <SearchSuggestions
          id={suggestionsId}
          suggestions={suggestions}
          selectedIndex={selectedIndex}
          onSelect={handleSelect}
          query={value}
        />
      )}
    </form>
  )
}

export { SearchInput }
export default SearchInput
