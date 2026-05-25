'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useFilterParams } from '@/hooks/use-filter-params'
import { cn } from '@/lib/utils'
import {
  trackSearchNoResults,
  trackSearchExecuted,
  trackSearchResultClicked,
} from '@/lib/analytics'
import type { SearchResult } from '@/lib/services/brands'
import { SearchSuggestions, SEARCH_SUGGESTIONS_ID } from './search-suggestions'

interface SearchInputProps {
  redirectTo?: string
  placeholder?: string
  className?: string
}

function SearchInput({ redirectTo, placeholder, className }: SearchInputProps = {}) {
  const { filters, setSearch } = useFilterParams()
  const [value, setValue] = useState(filters.search)
  const [suggestions, setSuggestions] = useState<SearchResult[]>([])
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [showDropdown, setShowDropdown] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLFormElement>(null)
  const router = useRouter()

  const fetchSuggestions = useCallback(async (q: string) => {
    if (!q.trim() || redirectTo) {
      setSuggestions([])
      setShowDropdown(false)
      return
    }

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=5`)
      if (!res.ok) {
        setSuggestions([])
        setShowDropdown(false)
        return
      }

      const data = await res.json()
      const results = data.results ?? []
      setSuggestions(results)
      setShowDropdown(true)
      setSelectedIndex(-1)
      if (results.length === 0 && q.trim()) {
        trackSearchNoResults(q)
      }
    } catch {
      // Ignore fetch errors; search filtering still works.
    }
  }, [redirectTo])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    debounceRef.current = setTimeout(() => {
      if (!value.trim()) {
        setSuggestions([])
        setShowDropdown(false)
      } else {
        fetchSuggestions(value)
      }
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [fetchSuggestions, value])

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

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value
    setValue(next)
    if (!redirectTo) {
      setSearch(next)
    }
  }

  function handleClear() {
    setValue('')
    if (!redirectTo) {
      setSearch('')
    }
    setSuggestions([])
    setShowDropdown(false)
  }

  function handleSelect(slug: string, index: number) {
    trackSearchResultClicked(value, index)
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
      trackSearchExecuted(q, suggestions.length)
      if (redirectTo) {
        // Use native navigation for cross-page redirects — router.push
        // intermittently fails in WebKit when navigating from / to /brands.
        window.location.href = `${redirectTo}?search=${encodeURIComponent(q)}`
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

  return (
    <form ref={containerRef} role="search" onSubmit={handleSubmit} className={cn('relative w-full max-w-md', className)}>
      {/* Search icon */}
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

      <input
        name="q"
        type="text"
        role="searchbox"
        aria-label="搜尋品牌"
        aria-autocomplete="list"
        aria-controls={showDropdown ? SEARCH_SUGGESTIONS_ID : undefined}
        aria-activedescendant={
          showDropdown && selectedIndex >= 0 && suggestions[selectedIndex]
            ? `search-suggestion-${suggestions[selectedIndex].id}`
            : undefined
        }
        placeholder={placeholder ?? '搜尋品牌...'}
        maxLength={100}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className="w-full rounded-lg border border-border bg-card py-2 pl-9 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />

      {/* Clear button */}
      {value && (
        <button
          type="button"
          onClick={handleClear}
          aria-label="清除搜尋"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
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
          suggestions={suggestions}
          selectedIndex={selectedIndex}
          onSelect={handleSelect}
        />
      )}
    </form>
  )
}

export { SearchInput }
export default SearchInput
