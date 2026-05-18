'use client'

import { useState } from 'react'
import { X, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TagCategory, TaxonomyTag } from '@/lib/types'
import { useFilterParams } from '@/hooks/use-filter-params'

const CATEGORY_LABELS: Record<TagCategory, string> = {
  product_type: 'Product Type',
  material: 'Material',
  price_range: 'Price Range',
  region: 'Region',
}

interface FilterPillProps {
  label: string
  active: boolean
  onToggle: () => void
}

function FilterPill({ label, active, onToggle }: FilterPillProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-medium leading-none transition-colors',
        'min-h-[36px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        active
          ? 'border-transparent bg-foreground text-background'
          : 'border-border bg-card text-foreground hover:bg-muted'
      )}
    >
      {label}
      {active && <X className="size-3 shrink-0 opacity-70" />}
    </button>
  )
}

interface CategoryGroupProps {
  category: TagCategory
  tags: TaxonomyTag[]
  selectedSlugs: string[]
  onToggle: (slug: string) => void
}

function CategoryGroup({ category, tags, selectedSlugs, onToggle }: CategoryGroupProps) {
  if (tags.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-500 uppercase tracking-wider text-muted-foreground">
        {CATEGORY_LABELS[category]}
      </p>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <FilterPill
            key={tag.id}
            label={tag.nameZh ?? tag.name}
            active={selectedSlugs.includes(tag.slug)}
            onToggle={() => onToggle(tag.slug)}
          />
        ))}
      </div>
    </div>
  )
}

interface TaxonomyFilterContentProps {
  tags: TaxonomyTag[]
  selectedSlugs: string[]
  activeCount: number
  onToggle: (slug: string) => void
  onClear: () => void
}

function TaxonomyFilterContent({
  tags,
  selectedSlugs,
  activeCount,
  onToggle,
  onClear,
}: TaxonomyFilterContentProps) {
  const categories: TagCategory[] = ['product_type', 'material', 'price_range', 'region']

  const tagsByCategory = categories.reduce<Record<TagCategory, TaxonomyTag[]>>(
    (acc, cat) => {
      acc[cat] = tags.filter((t) => t.category === cat)
      return acc
    },
    { product_type: [], material: [], price_range: [], region: [] }
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Filters</h2>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors min-h-[36px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" />
            Clear all
            <span className="ml-1 inline-flex size-5 items-center justify-center rounded-full bg-foreground text-background text-[11px] font-medium">
              {activeCount}
            </span>
          </button>
        )}
      </div>

      {categories.map((cat) => (
        <CategoryGroup
          key={cat}
          category={cat}
          tags={tagsByCategory[cat]}
          selectedSlugs={selectedSlugs}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
}

interface TaxonomyFilterSidebarProps {
  tags: TaxonomyTag[]
}

/**
 * Desktop: persistent left sidebar with filter pills.
 * Mobile: collapsible panel toggled by a filter button.
 */
export function TaxonomyFilterSidebar({ tags }: TaxonomyFilterSidebarProps) {
  const { selectedSlugs, toggleSlug, clearFilters, activeCount } = useFilterParams()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <>
      {/* Mobile filter toggle button */}
      <div className="flex items-center justify-between md:hidden mb-4">
        <button
          type="button"
          onClick={() => setMobileOpen((prev) => !prev)}
          className={cn(
            'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-medium transition-colors',
            'min-h-[48px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            activeCount > 0
              ? 'border-transparent bg-foreground text-background'
              : 'border-border bg-card text-foreground hover:bg-muted'
          )}
          aria-expanded={mobileOpen}
          aria-label="Toggle filters"
        >
          <SlidersHorizontal className="size-4" />
          Filters
          {activeCount > 0 && (
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-background text-foreground text-[11px] font-medium">
              {activeCount}
            </span>
          )}
        </button>

        {activeCount > 0 && (
          <button
            type="button"
            onClick={clearFilters}
            className="flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors min-h-[48px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" />
            Clear all
          </button>
        )}
      </div>

      {/* Mobile collapsible panel */}
      {mobileOpen && (
        <div className="md:hidden mb-6 rounded-xl border border-border bg-card p-4">
          <TaxonomyFilterContent
            tags={tags}
            selectedSlugs={selectedSlugs}
            activeCount={activeCount}
            onToggle={toggleSlug}
            onClear={clearFilters}
          />
        </div>
      )}

      {/* Desktop persistent sidebar */}
      <aside
        className="hidden md:block w-52 shrink-0"
        aria-label="Filter brands by category"
      >
        <div className="sticky top-24">
          <TaxonomyFilterContent
            tags={tags}
            selectedSlugs={selectedSlugs}
            activeCount={activeCount}
            onToggle={toggleSlug}
            onClear={clearFilters}
          />
        </div>
      </aside>
    </>
  )
}
