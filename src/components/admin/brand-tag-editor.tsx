'use client'

import { useState } from 'react'
import type { TaxonomyTag, TagSource } from '@/lib/types/taxonomy'

interface Props {
  brand: { id: string; name: string; tags: Array<TaxonomyTag & { source: TagSource }> }
  allTags: TaxonomyTag[]
  onSave: (tagIds: string[]) => void | Promise<void>
}

export function BrandTagEditor({ brand, allTags, onSave }: Props) {
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(
    brand.tags.map((t) => t.id),
  )
  const [isSaving, setIsSaving] = useState(false)

  const autoTagIds = new Set(
    brand.tags.filter((t) => t.source === 'auto').map((t) => t.id),
  )

  const grouped = allTags.reduce<Record<string, TaxonomyTag[]>>((acc, tag) => {
    if (!acc[tag.category]) acc[tag.category] = []
    acc[tag.category].push(tag)
    return acc
  }, {})

  function toggleTag(tagId: string) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    )
  }

  async function handleSave() {
    setIsSaving(true)
    await onSave(selectedTagIds)
    setIsSaving(false)
  }

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([category, tags]) => (
        <div key={category}>
          <p className="text-[13px] font-semibold text-[#3B2F2A] mb-2">{category}</p>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => {
              const isSelected = selectedTagIds.includes(tag.id)
              const isAuto = autoTagIds.has(tag.id)
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTag(tag.id)}
                  className={
                    isSelected
                      ? 'rounded-full border border-[#1A1918] bg-[#1A1918] px-3.5 py-1.5 text-[13px] font-medium text-white'
                      : 'rounded-full border border-[#E5E4E1] px-3.5 py-1.5 text-[13px] font-medium text-[#1A1918]'
                  }
                >
                  {tag.name}
                  {isAuto && (
                    <span
                      className={
                        isSelected
                          ? 'text-[11px] font-medium text-white/70 bg-white/20 rounded-full px-2 py-0.5 ml-1'
                          : 'text-[11px] font-medium text-[#857E79] bg-[#F5F4F1] rounded-full px-2 py-0.5 ml-1'
                      }
                    >
                      auto
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={handleSave}
        disabled={isSaving}
        className="bg-[#E06B3F] text-white rounded-lg px-6 py-3 text-sm font-semibold disabled:opacity-60"
      >
        {isSaving ? 'Saving...' : 'Save Tags'}
      </button>
    </div>
  )
}
