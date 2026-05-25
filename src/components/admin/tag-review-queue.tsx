'use client'

import type { TaxonomyTag } from '@/lib/types/taxonomy'
import type { BrandForReview } from '@/lib/services/taxonomy'

interface Props {
  brands: BrandForReview[]
  allTags: TaxonomyTag[]
  onConfirm: (brandId: string, tagIds: string[]) => void
  onEdit: (brand: BrandForReview) => void
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function TagReviewQueue({ brands, onConfirm, onEdit, allTags }: Props) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center justify-center rounded-full bg-[#1A1918] px-2 py-0.5 text-[11px] font-medium text-white">
          {brands.length}
        </span>
        <span className="text-sm font-medium text-[#7C7570]">brands pending review</span>
      </div>

      {brands.length === 0 ? (
        <p className="text-sm text-[#7C7570]">No brands pending review.</p>
      ) : (
        <div className="divide-y divide-[#E5E4E1] rounded-lg border border-[#E5E4E1]">
          {brands.map((brand) => (
            <div key={brand.id} className="flex items-center justify-between gap-4 px-4 py-3">
              {/* Brand name + tag pills */}
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-[#1A1918]">{brand.name}</span>
                {brand.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center rounded-full bg-[#F5F4F1] px-2.5 py-0.5 text-[12px] font-medium text-[#3B2F2A]"
                  >
                    {tag.name}
                  </span>
                ))}
              </div>

              {/* Actions */}
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => onConfirm(brand.id, brand.tags.map((t) => t.id))}
                  className="rounded-md border border-[#1A1918] px-3 py-1.5 text-xs font-medium text-[#1A1918] transition-colors hover:bg-[#1A1918] hover:text-white"
                >
                  Confirm ✓
                </button>
                <button
                  type="button"
                  onClick={() => onEdit(brand)}
                  className="rounded-md px-3 py-1.5 text-xs font-medium text-[#7C7570] transition-colors hover:bg-[#F5F4F1] hover:text-[#1A1918]"
                >
                  Edit
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
