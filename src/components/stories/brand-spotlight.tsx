import type { ReactNode } from 'react'
import Image from 'next/image'
import { getLocale, getTranslations } from 'next-intl/server'

import { BrandImageFallback } from '@/components/brands/brand-image-fallback'
import { Badge } from '@/components/ui/badge'
import { Link } from '@/i18n/navigation'
import { getBrandCategoryLabel } from '@/lib/brands/category-label'
import { safeImageSrc } from '@/lib/images/allowed-image-hosts'
import { getBrandsBySlugs } from '@/lib/services/brands'
import { MissingBrandNotice } from './brand-card-mdx'

type BrandSpotlightProps = {
  slug: string
  children?: ReactNode
}

/**
 * `<BrandSpotlight slug="…">…</BrandSpotlight>` inside story MDX: one brand at
 * full column width, with the author's prose (the MDX children) as the body.
 * The card variants truncate; a spotlight deliberately does not.
 */
export async function BrandSpotlight({ slug, children }: BrandSpotlightProps) {
  const brands = await getBrandsBySlugs([slug])
  const brand = brands.get(slug)

  if (!brand) {
    const t = await getTranslations('stories')
    return <MissingBrandNotice label={t('brandMissing', { slug })} />
  }

  const locale = await getLocale()
  const categoryLabel = getBrandCategoryLabel(brand, locale === 'en' ? 'en' : 'zh-TW')
  const imageSrc = safeImageSrc(brand.heroImageUrl)

  return (
    <section className="my-10 space-y-4">
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-border bg-muted">
        {imageSrc ? (
          <Image
            src={imageSrc}
            alt=""
            fill
            className="object-contain"
            sizes="(max-width: 768px) 100vw, 720px"
          />
        ) : (
          <BrandImageFallback name={brand.name} category={brand.category} size="detail" />
        )}
      </div>
      <div className="space-y-2">
        <h3 className="type-section-title">
          <Link
            href={`/brands/${brand.slug}`}
            className="inline-flex min-h-11 items-center rounded-xs text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {brand.name}
          </Link>
        </h3>
        {categoryLabel ? <Badge variant="secondary">{categoryLabel}</Badge> : null}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}
