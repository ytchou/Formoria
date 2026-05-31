'use client'

import { useTranslations } from 'next-intl'
import type { SearchResult } from '@/lib/services/brands'

interface SearchSuggestionsProps {
  suggestions: SearchResult[]
  selectedIndex: number
  onSelect: (slug: string, index: number) => void
}

export const SEARCH_SUGGESTIONS_ID = 'search-suggestions-listbox'

export function SearchSuggestions({
  suggestions,
  selectedIndex,
  onSelect,
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
            <span className="font-medium text-foreground">{item.name}</span>
            {item.category && (
              <span className="ml-2 text-xs text-muted-foreground">
                {item.category}
              </span>
            )}
          </li>
        ))
      )}
    </ul>
  )
}
