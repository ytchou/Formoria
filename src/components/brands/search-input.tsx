'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { localizePath } from '@/i18n/locale-preference'
import { useFilterParams } from '@/hooks/use-filter-params'
import { cn } from '@/lib/utils'
import { SearchFieldShell } from '@/components/search/search-field-shell'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
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
import { routes } from '@/lib/routes'

interface SearchInputProps {
  redirectTo?: string
  placeholder?: string
  className?: string
  formAriaLabel?: string
  showAutocomplete?: boolean
  announceLoading?: boolean
  /** Visible label above the field. The searchbox keeps its own accessible name. */
  label: string
  /** Visible primary submit button beside the field. */
  submitLabel: string
}

function SearchInput({
  redirectTo,
  placeholder,
  className,
  formAriaLabel,
  showAutocomplete = true,
  announceLoading = true,
  label,
  submitLabel,
}: SearchInputProps) {
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
  // The term last applied by a submit. Suggestions stay closed for it until the
  // visitor types again, so a debounce re-run (e.g. `setSearch` changing
  // identity after the URL update) cannot reopen the dropdown.
  const submittedValueRef = useRef<string | null>(null)
  const containerRef = useRef<HTMLFormElement>(null)
  const router = useRouter()
  // Per-instance, not a module constant: the homepage renders this field twice
  // at `md+` (hero and nav), and one shared listbox id pointed `aria-controls`
  // at whichever list happened to be first in the DOM.
  const suggestionsId = useId()
  const inputId = useId()

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
    if (submittedValueRef.current === value) return

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
    submittedValueRef.current = null
    setValue(e.target.value)
    setIsFetchingSuggestions(showAutocomplete && e.target.value.trim().length >= 2)
  }

  function handleClear() {
    abortRef.current?.abort()
    inputVersionRef.current += 1
    submittedValueRef.current = null
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
    router.push(routes.brand(slug))
  }

  function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (selectedIndex >= 0 && suggestions[selectedIndex]) {
      handleSelect(suggestions[selectedIndex].slug, selectedIndex)
      return
    }
    if (!redirectTo) {
      // This page's results follow the field after a 200ms debounce; a submit
      // (Enter or the submit button) applies the pending value now instead.
      // The submit also ends any suggestion work: the pending fetch is aborted
      // and invalidated, and the busy state it set in handleChange is reset
      // here, because setSearch is a no-op when the term is already in the URL.
      if (debounceRef.current) clearTimeout(debounceRef.current)
      abortRef.current?.abort()
      inputVersionRef.current += 1
      submittedValueRef.current = value
      setSearch(value)
      setSuggestions([])
      setShowDropdown(false)
      setSelectedIndex(-1)
      setIsFetchingSuggestions(false)
      return
    }
    const q = (new FormData(e.currentTarget).get('q') as string)?.trim() ?? ''
    if (q) {
      // No search event here. This form only knows `suggestions` — the typeahead's
      // list, which answers a different query, caps at 5, and is still empty inside
      // the 200ms debounce. SearchResultsTracker emits from the results page, where
      // the real total is known (DEV-1412).
      // Use native navigation for cross-page redirects — router.push
      // intermittently fails in WebKit when navigating from / to /brands.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = `${localizePath(redirectTo, locale)}?search=${encodeURIComponent(q)}`
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
      className={cn('w-full space-y-2', className)}
      data-ph-no-autocapture
    >
      {announceLoading ? (
        <span className="sr-only" role="status" aria-live="polite">
          {isBusy ? t('search.loading') : ''}
        </span>
      ) : null}

      <Label htmlFor={inputId} className="type-label">
        {label}
      </Label>

      <div className="flex items-center gap-2">
        {/* The dropdown anchors to the field, not to the field plus the button. */}
        <div className="relative min-w-0 flex-1">
          <SearchFieldShell
            value={value}
            onChange={handleChange}
            onClear={handleClear}
            busy={isBusy}
            clearLabel={t('search.clear')}
            inputProps={{
              id: inputId, name: 'q', type: 'search',
              'aria-label': t('search.aria'),
              'aria-autocomplete': 'list',
              'aria-controls': showDropdown ? suggestionsId : undefined,
              'aria-activedescendant': showDropdown && selectedIndex >= 0 && suggestions[selectedIndex]
                ? searchSuggestionOptionId(suggestionsId, suggestions[selectedIndex].id) : undefined,
              placeholder: placeholder ?? t('search.placeholder'),
              maxLength: 100, onKeyDown: handleKeyDown,
            }}
          />

          {showDropdown && (
            <SearchSuggestions
              id={suggestionsId}
              suggestions={suggestions}
              selectedIndex={selectedIndex}
              onSelect={handleSelect}
              query={value}
            />
          )}
        </div>

        <Button type="submit" variant="primary">
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

export { SearchInput }
export default SearchInput
