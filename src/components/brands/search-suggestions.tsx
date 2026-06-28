'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import type { SearchResult } from '@/lib/services/brands'

interface SearchSuggestionsProps {
  suggestions: SearchResult[]
  selectedIndex: number
  onSelect: (slug: string, index: number) => void
  query: string
}

function highlightMatch(text: string, query: string): ReactNode {
  if (!query) return text
  const lower = text.toLowerCase()
  const idx = lower.indexOf(query.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-primary/10 text-foreground rounded-sm">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  )
}

export const SEARCH_SUGGESTIONS_ID = 'search-suggestions-listbox'

export function SearchSuggestions({
  suggestions,
  selectedIndex,
  onSelect,
  query,
}: SearchSuggestionsProps) {
  const t = useTranslations('brands')
  return (
    <ul
      id={SEARCH_SUGGESTIONS_ID}
      role="listbox"
      className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-card shadow-lg"
    >
      {suggestions.length === 0 ? (
        <li className="px-4 py-3 text-sm text-muted-foreground">{t('noResultsInSuggestions')}</li>
      ) : (
        suggestions.map((item, index) => (
          <li
            key={item.id}
            id={`search-suggestion-${item.id}`}
            role="option"
            aria-selected={index === selectedIndex}
            onClick={() => onSelect(item.slug, index)}
            className={`cursor-pointer px-4 py-3 text-sm ${
              index === selectedIndex ? 'bg-secondary' : 'hover:bg-secondary'
            }`}
          >
            <span className="font-medium text-foreground">{highlightMatch(item.name, query)}</span>
            {item.category && (
              <span className="ml-2 text-xs text-muted-foreground">
                {highlightMatch(item.category, query)}
              </span>
            )}
          </li>
        ))
      )}
    </ul>
  )
}
