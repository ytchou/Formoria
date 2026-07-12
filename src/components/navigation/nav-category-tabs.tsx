'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter, usePathname } from '@/i18n/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { trackCategoryFilterApplied } from '@/lib/analytics'
import { categoryLabel } from '@/lib/taxonomy/ontology'

interface NavCategoryTabsProps {
  categories: Array<{ slug: string; name: string; nameZh: string | null }>
}

function NavCategoryTabsInner({ categories }: NavCategoryTabsProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const locale = useLocale()
  const t = useTranslations('nav')

  const isBrandsPage = pathname === '/brands'
  const activeCategory = isBrandsPage ? (searchParams.get('category') ?? '') : ''

  function handleClick(slug: string) {
    if (slug) {
      trackCategoryFilterApplied(slug)
    }

    if (isBrandsPage) {
      const params = new URLSearchParams(searchParams.toString())
      if (slug) {
        params.set('category', slug)
      } else {
        params.delete('category')
      }
      params.delete('page')
      const qs = params.toString()
      router.replace(qs ? `/brands?${qs}` : '/brands')
    } else {
      router.push(slug ? `/brands?category=${encodeURIComponent(slug)}` : '/brands')
    }
  }

  return (
    <nav className="page-gutter mx-auto max-w-screen-xl overflow-x-hidden">
      <div className="flex h-11 items-center gap-1 overflow-x-auto scrollbar-none">
        <button
          type="button"
          data-active={isBrandsPage && !activeCategory ? 'true' : 'false'}
          onClick={() => handleClick('')}
          className={
            isBrandsPage && !activeCategory
              ? 'type-body-emphasis border-b-2 border-foreground whitespace-nowrap px-3 py-2'
              : 'type-card-description hover:text-foreground whitespace-nowrap px-3 py-2 transition-colors'
          }
        >
          {t('allBrands')}
        </button>
        {categories.map((cat) => {
          const isActive = activeCategory === cat.slug
          const label = categoryLabel(cat, locale)
          return (
            <button
              key={cat.slug}
              type="button"
              data-active={isActive ? 'true' : 'false'}
              onClick={() => handleClick(cat.slug)}
              className={
                isActive
                  ? 'type-body-emphasis border-b-2 border-foreground whitespace-nowrap px-3 py-2'
                  : 'type-card-description hover:text-foreground whitespace-nowrap px-3 py-2 transition-colors'
              }
            >
              {label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

export function NavCategoryTabs({ categories }: NavCategoryTabsProps) {
  return (
    <Suspense>
      <NavCategoryTabsInner categories={categories} />
    </Suspense>
  )
}
