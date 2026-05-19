'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'

interface CategoryPillsProps {
  categories: Array<{ slug: string; name: string }>
}

export function CategoryPills({ categories }: CategoryPillsProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()

  const activeCategory = searchParams.get('category') ?? ''

  function handleClick(slug: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (slug) {
      params.set('category', slug)
    } else {
      params.delete('category')
    }
    params.delete('page')
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <div className="flex gap-2 overflow-x-auto snap-x pb-2 scrollbar-none">
      {/* All pill */}
      <button
        type="button"
        data-active={!activeCategory ? 'true' : 'false'}
        onClick={() => handleClick('')}
        className={`shrink-0 snap-start rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
          !activeCategory
            ? 'bg-foreground text-background'
            : 'border border-border bg-card text-foreground hover:bg-secondary'
        }`}
      >
        All
      </button>

      {/* Category pills */}
      {categories.map((cat) => {
        const isActive = activeCategory === cat.slug
        return (
          <button
            key={cat.slug}
            type="button"
            data-active={isActive ? 'true' : 'false'}
            onClick={() => handleClick(cat.slug)}
            className={`shrink-0 snap-start rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              isActive
                ? 'bg-foreground text-background'
                : 'border border-border bg-card text-foreground hover:bg-secondary'
            }`}
          >
            {cat.name}
          </button>
        )
      })}
    </div>
  )
}
