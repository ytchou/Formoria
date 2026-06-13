'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { BrandCard } from '@/components/brands/brand-card'
import type { Brand } from '@/lib/types/brand'
import type { TaxonomyTag } from '@/lib/types'

interface ValueBrandShowcaseProps {
  brands: Brand[]
  tags: TaxonomyTag[]
}

export default function ValueBrandShowcase({
  brands,
  tags,
}: ValueBrandShowcaseProps) {
  const t = useTranslations('landing.valueChips')
  const locale = useLocale()
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
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
    if (!selectedTag) return brands
    return brands.filter((b) =>
      b.tags.some((t) => t.slug === selectedTag && t.category === 'value'),
    )
  }, [brands, selectedTag])

  const displayBrands = filteredBrands.slice(0, 4)

  const selectedTagLabel = selectedTag
    ? (() => {
        const tag = tags.find((t) => t.slug === selectedTag)
        if (!tag) return null
        return locale === 'en' ? tag.name : (tag.nameZh ?? tag.name)
      })()
    : null

  const ctaText = selectedTagLabel
    ? t('browseAllValue', { value: selectedTagLabel })
    : t('browseAll')

  const ctaHref = selectedTag
    ? `/brands?tags=${selectedTag}`
    : '/brands'

  return (
    <section>
      <h2 className="font-heading text-2xl font-bold">{t('heading')}</h2>

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
          className="flex gap-2 overflow-x-auto scrollbar-none"
        >
          <button
            onClick={() => setSelectedTag(null)}
            className={`shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-sm transition-colors ${
              !selectedTag
                ? 'border border-transparent bg-primary text-primary-foreground'
                : 'border border-border bg-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground'
            }`}
          >
            {t('all')}
          </button>
          {tags.map((tag) => (
            <button
              key={tag.slug}
              onClick={() => setSelectedTag(tag.slug)}
              className={`shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-sm transition-colors ${
                selectedTag === tag.slug
                  ? 'border border-transparent bg-primary text-primary-foreground'
                  : 'border border-border bg-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground'
              }`}
            >
              {locale === 'en' ? tag.name : (tag.nameZh ?? tag.name)}
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
        <p className="mt-6 text-sm text-muted-foreground">
          {t('emptyValue')}
        </p>
      )}

      {filteredBrands.length > 0 && (
        <div className="mt-6">
          <Link href={ctaHref} className="font-medium text-primary">
            {ctaText}
          </Link>
        </div>
      )}
    </section>
  )
}
