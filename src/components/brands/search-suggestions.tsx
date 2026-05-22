'use client'

import type { SearchResult } from '@/lib/services/brands'

interface SearchSuggestionsProps {
  suggestions: SearchResult[]
  selectedIndex: number
  onSelect: (slug: string) => void
}

export function SearchSuggestions({
  suggestions,
  selectedIndex,
  onSelect,
}: SearchSuggestionsProps) {
  return (
    <ul
      role="listbox"
      className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border border-[#E5E4E1] bg-white shadow-lg"
    >
      {suggestions.length === 0 ? (
        <li className="px-4 py-3 text-sm text-[#857E79]">No results found</li>
      ) : (
        suggestions.map((item, index) => (
          <li
            key={item.id}
            role="option"
            aria-selected={index === selectedIndex}
            onClick={() => onSelect(item.slug)}
            className={`cursor-pointer px-4 py-3 text-sm ${
              index === selectedIndex ? 'bg-[#F5F4F1]' : 'hover:bg-[#F5F4F1]'
            }`}
          >
            <span className="font-medium text-[#1A1918]">{item.name}</span>
            {item.category && (
              <span className="ml-2 text-xs text-[#857E79]">
                {item.category}
              </span>
            )}
          </li>
        ))
      )}
    </ul>
  )
}
