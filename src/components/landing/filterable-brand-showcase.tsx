'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { BrandCard } from '@/components/brands/brand-card'
import type { Brand } from '@/lib/types/brand'

interface Category {
  slug: string
  name: string
  nameZh: string | null
}

interface FilterableBrandShowcaseProps {
  brands: Brand[]
  categories: Category[]
}

export default function FilterableBrandShowcase({
  brands,
  categories,
}: FilterableBrandShowcaseProps) {
  const t = useTranslations('landing.showcase')
  const locale = useLocale()
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 0)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])

  useEffect(() => {
    updateScrollState()
    window.addEventListener('resize', updateScrollState)
    return () => window.removeEventListener('resize', updateScrollState)
  }, [updateScrollState])

  const filteredBrands = useMemo(() => {
    if (!selectedCategory) return brands
    return brands.filter((b) => b.category === selectedCategory)
  }, [brands, selectedCategory])

  const displayBrands = filteredBrands.slice(0, 4)

  const selectedCategoryLabel = selectedCategory
    ? (() => {
        const cat = categories.find((c) => c.slug === selectedCategory)
        if (!cat) return null
        return locale === 'en' ? cat.name : (cat.nameZh ?? cat.name)
      })()
    : null

  const ctaText = selectedCategoryLabel
    ? t('browseAllCategory', { category: selectedCategoryLabel })
    : t('browseAll')

  const ctaHref = selectedCategory
    ? `/brands?category=${selectedCategory}`
    : '/brands'

  return (
    <section>
      <h2 className="type-section-title-large">{t('heading')}</h2>

      <div className="relative mt-3">
        <div
          className={`pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-background to-transparent transition-opacity ${canScrollLeft ? 'opacity-100' : 'opacity-0'}`}
        />
        <div
          className={`pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent transition-opacity ${canScrollRight ? 'opacity-100' : 'opacity-0'}`}
        />
        <div
          ref={scrollRef}
          onScroll={updateScrollState}
          role="group"
          aria-label={t('filterLabel')}
          className="flex gap-2 overflow-x-auto scrollbar-none"
        >
          <button
            onClick={() => setSelectedCategory(null)}
            aria-pressed={!selectedCategory}
            className={`shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-sm transition-colors ${
              !selectedCategory
                ? 'border border-transparent bg-primary text-primary-foreground'
                : 'border border-border bg-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground'
            }`}
          >
            {t('all')}
          </button>
          {categories.map((cat) => (
            <button
              key={cat.slug}
              onClick={() => setSelectedCategory(cat.slug)}
              aria-pressed={selectedCategory === cat.slug}
              className={`shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-sm transition-colors ${
                selectedCategory === cat.slug
                  ? 'border border-transparent bg-primary text-primary-foreground'
                  : 'border border-border bg-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground'
              }`}
            >
              {locale === 'en' ? cat.name : (cat.nameZh ?? cat.name)}
            </button>
          ))}
        </div>
      </div>

      {displayBrands.length > 0 ? (
        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {displayBrands.map((brand, i) => (
            <BrandCard key={brand.id} brand={brand} position={i} />
          ))}
        </div>
      ) : (
        <div className="mt-6 text-center">
          <p className="type-card-description">{t('emptyCategory')}</p>
          <button
            type="button"
            onClick={() => setSelectedCategory(null)}
            className="mt-3 type-body-emphasis text-cta hover:underline"
          >
            {t('showAll')}
          </button>
        </div>
      )}

      {filteredBrands.length > 0 && (
        <div className="mt-6">
          <Link href={ctaHref} className="type-body-emphasis text-primary">
            {ctaText}
          </Link>
        </div>
      )}
    </section>
  )
}
