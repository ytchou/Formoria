import type { ReactNode } from 'react'
import Image from 'next/image'
import { getLocale, getTranslations } from 'next-intl/server'

import { BrandImageFallback } from '@/components/brands/brand-image-fallback'
import { Badge } from '@/components/ui/badge'
import { surfaceCardStyles } from '@/components/ui/card'
import { Link } from '@/i18n/navigation'
import { getBrandCategoryLabel } from '@/lib/brands/category-label'
import { safeImageSrc } from '@/lib/images/allowed-image-hosts'
import { getBrandsBySlugs } from '@/lib/services/brands'
import { cn } from '@/lib/utils'
import { MissingBrandNotice } from './brand-card-mdx'

type BrandSpotlightProps = {
  slug: string
  /**
   * Author-supplied scannable line, e.g. a booth number. Optional.
   *
   * A plain string, not an object or array: MDX expression attributes
   * (`meta={…}`) are silently dropped by the story pipeline (DEV-1302), so a
   * structured prop would arrive `undefined` at runtime. It is also not
   * derivable — booth numbers live on `event_brands`, and a story shortcode
   * carries no event context.
   */
  meta?: string
  children?: ReactNode
}

/**
 * `<BrandSpotlight slug="…">…</BrandSpotlight>` inside story MDX: one brand as
 * a horizontal card, with the author's prose (the MDX children) as the body.
 * The card variants truncate; a spotlight deliberately does not — that
 * non-truncation is the only reason this is not a `BrandCard` variant, so never
 * add a clamp, max-height, or fade to the prose column.
 *
 * The layout is a two-column grid rather than a flex row because mobile needs
 * the prose to break out from beside the thumbnail and span the full card
 * width: at 375px a ~203px column gives roughly 13 CJK characters per line.
 * Grid lets the prose change which columns it occupies at `sm` without
 * duplicating the markup.
 */
export async function BrandSpotlight({ slug, meta, children }: BrandSpotlightProps) {
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
    <section className={cn(surfaceCardStyles({ padding: 'md' }), 'my-10')}>
      <div className="grid grid-cols-[auto_1fr] items-start gap-x-4 gap-y-4 sm:gap-x-5">
        {/*
         * `object-cover`, not `object-contain`: at 152px the image identifies the
         * brand rather than documenting it, and contain letterboxed every hero
         * whose aspect ratio was not 4:3. Full framing belongs on the detail page.
         * The tile is the tallest child until the prose passes ~5 lines, which is
         * what floors short spotlights at a shared height.
         */}
        <div className="relative size-24 shrink-0 overflow-hidden rounded-lg border border-border bg-muted sm:size-38">
          {imageSrc ? (
            <Image
              src={imageSrc}
              alt=""
              fill
              className="object-cover"
              sizes="(max-width: 640px) 96px, 152px"
            />
          ) : (
            <BrandImageFallback name={brand.name} category={brand.category} size="card" />
          )}
        </div>
        <div className="min-w-0 space-y-1">
          {/*
           * The 44px row exists for the link's touch target, not for the type.
           * The badge rides along in slack that would otherwise be dead space —
           * don't collapse the row height to tighten the card.
           */}
          <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="type-section-title">
              <Link
                href={`/brands/${brand.slug}`}
                className="inline-flex min-h-11 items-center rounded-sm text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {brand.name}
              </Link>
            </h3>
            {categoryLabel ? <Badge variant="secondary">{categoryLabel}</Badge> : null}
          </div>
          {meta ? <p className="type-metadata">{meta}</p> : null}
        </div>
        {/* Full width below `sm`, second column above it — see the layout note above. */}
        <div className="col-span-2 space-y-4 sm:col-span-1 sm:col-start-2">{children}</div>
      </div>
    </section>
  )
}
