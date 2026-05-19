'use client'

import { useState } from 'react'
import { useFilterParams } from '@/hooks/use-filter-params'

export function SearchInput() {
  const { filters, setSearch } = useFilterParams()
  const [value, setValue] = useState(filters.search)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value
    setValue(next)
    setSearch(next)
  }

  function handleClear() {
    setValue('')
    setSearch('')
  }

  return (
    <div className="relative w-full max-w-md">
      {/* Search icon */}
      <svg
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7C7570]"
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
        type="search"
        role="searchbox"
        aria-label="Search brands"
        placeholder="Search brands..."
        maxLength={100}
        value={value}
        onChange={handleChange}
        className="w-full rounded-lg border border-[#E5E4E1] bg-white py-2 pl-9 pr-8 text-sm text-[#1A1918] placeholder:text-[#857E79] focus:outline-none focus:ring-2 focus:ring-[#8B5E3C]"
      />

      {/* Clear button */}
      {value && (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[#7C7570] hover:text-[#1A1918]"
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
    </div>
  )
}
