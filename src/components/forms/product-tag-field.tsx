'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { Input } from '@/components/ui/input'

type ProductTagFieldProps = {
  initialTags?: string[]
  value?: string[]
  onChange?: (tags: string[]) => void
  suggestions?: string[]
  inputLabel: string
  placeholder: string
  removeLabel: string
  maxLabel?: string
}

const MAX_TAGS = 5

function normalizeTag(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export function ProductTagField({
  initialTags,
  value: controlledTags,
  onChange,
  suggestions = [],
  inputLabel,
  placeholder,
  removeLabel,
  maxLabel,
}: ProductTagFieldProps) {
  const [internalTags, setInternalTags] = useState(() => (initialTags ?? []).slice(0, MAX_TAGS))
  const [value, setValue] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const tags = controlledTags ?? internalTags
  const normalizedValue = normalizeTag(value).toLocaleLowerCase('en')
  const filteredSuggestions = normalizedValue
    ? suggestions
        .filter((suggestion) => suggestion.toLocaleLowerCase('en').includes(normalizedValue))
        .filter((suggestion) => (
          !tags.some((tag) => tag.toLocaleLowerCase('en') === suggestion.toLocaleLowerCase('en'))
        ))
        .slice(0, 6)
    : []

  function updateTags(nextTags: string[]) {
    if (controlledTags === undefined) setInternalTags(nextTags)
    onChange?.(nextTags)
  }

  function addTag(rawValue: string) {
    const tag = normalizeTag(rawValue)
    if (!tag || tag.length > 40 || tags.length >= MAX_TAGS) {
      setValue('')
      setShowSuggestions(false)
      return
    }
    if (tags.some((current) => current.toLowerCase() === tag.toLowerCase())) {
      setValue('')
      setShowSuggestions(false)
      return
    }
    updateTags([...tags, tag])
    setValue('')
    setShowSuggestions(false)
  }

  const listboxId = 'productTags-listbox'
  const isExpanded = showSuggestions && filteredSuggestions.length > 0

  return (
    <div className="space-y-2">
      <input type="hidden" name="productTags" value={tags.join(',')} />
      <div className="relative flex min-h-11 flex-wrap gap-2 rounded-lg border border-border bg-background p-2">
        {tags.map((tag) => (
          <span
            key={tag.toLowerCase()}
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary"
          >
            {tag}
            <button
              type="button"
              aria-label={`${removeLabel}: ${tag}`}
              className="rounded-full p-0.5 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => updateTags(tags.filter((item) => item !== tag))}
            >
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        {tags.length < MAX_TAGS ? (
          <Input
            id="productTags"
            role="combobox"
            aria-label={inputLabel}
            aria-expanded={isExpanded}
            aria-controls={isExpanded ? listboxId : undefined}
            aria-autocomplete="list"
            className="h-8 min-w-40 flex-1 border-0 px-1 shadow-none focus-visible:ring-0"
            placeholder={placeholder}
            value={value}
            maxLength={40}
            onChange={(event) => {
              setValue(event.target.value)
              setShowSuggestions(true)
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => addTag(value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ',') {
                event.preventDefault()
                addTag(value)
              }
              if (event.key === 'Escape') {
                setShowSuggestions(false)
              }
            }}
          />
        ) : null}
        {isExpanded ? (
          <div
            id={listboxId}
            role="listbox"
            aria-label={inputLabel}
            className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-md"
          >
            {filteredSuggestions.map((suggestion) => (
              <button
                key={suggestion.toLocaleLowerCase('en')}
                type="button"
                role="option"
                aria-selected="false"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addTag(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {maxLabel ? <p className="text-xs text-muted-foreground">{maxLabel}</p> : null}
    </div>
  )
}
