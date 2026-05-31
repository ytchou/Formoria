'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { trackCategoryFilterApplied } from '@/lib/analytics'

interface CategoryPillsProps {
  categories: Array<{ slug: string; name: string; nameZh: string | null }>
}

export function CategoryPills({ categories }: CategoryPillsProps) {
  const t = useTranslations('brands')
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()

  const activeCategory = searchParams.get('category') ?? ''

  function handleClick(slug: string) {
    if (slug) {
      trackCategoryFilterApplied(slug)
    }
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
        {t('categoryAll')}
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
            {cat.nameZh ?? cat.name}
          </button>
        )
      })}
    </div>
  )
}
