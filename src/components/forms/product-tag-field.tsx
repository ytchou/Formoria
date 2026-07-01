'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { Input } from '@/components/ui/input'

type ProductTagFieldProps = {
  initialTags: string[]
  inputLabel: string
  placeholder: string
  removeLabel: string
  maxLabel: string
}

const MAX_TAGS = 5

function normalizeTag(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export function ProductTagField({
  initialTags,
  inputLabel,
  placeholder,
  removeLabel,
  maxLabel,
}: ProductTagFieldProps) {
  const [tags, setTags] = useState(() => initialTags.slice(0, MAX_TAGS))
  const [value, setValue] = useState('')

  function addTag(rawValue: string) {
    const tag = normalizeTag(rawValue)
    if (!tag || tag.length > 40 || tags.length >= MAX_TAGS) return
    if (tags.some((current) => current.toLowerCase() === tag.toLowerCase())) return
    setTags((current) => [...current, tag])
    setValue('')
  }

  return (
    <div className="space-y-2">
      <input type="hidden" name="productTags" value={tags.join(',')} />
      <div className="flex min-h-11 flex-wrap gap-2 rounded-lg border border-border bg-background p-2">
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
              onClick={() => setTags((current) => current.filter((item) => item !== tag))}
            >
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        {tags.length < MAX_TAGS ? (
          <Input
            id="productTags"
            aria-label={inputLabel}
            className="h-8 min-w-40 flex-1 border-0 px-1 shadow-none focus-visible:ring-0"
            placeholder={placeholder}
            value={value}
            maxLength={40}
            onChange={(event) => setValue(event.target.value)}
            onBlur={() => addTag(value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ',') {
                event.preventDefault()
                addTag(value)
              }
            }}
          />
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{maxLabel}</p>
    </div>
  )
}
