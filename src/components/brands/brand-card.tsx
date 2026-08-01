'use client'

import { useState } from 'react'
import { Link } from '@/i18n/navigation'
import Image from 'next/image'
import { useTranslations, useLocale } from 'next-intl'
import type { Brand } from '@/lib/types'
import {
  trackBrandCardClicked,
  trackRecommendationBrandClicked,
  trackSavedBrandRevisited,
} from '@/lib/analytics'
import { useSavedBrands } from '@/hooks/use-saved-brands'
import { surfaceCardStyles } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { safeImageSrc } from '@/lib/images/allowed-image-hosts'
import { getBrandCategoryLabel } from '@/lib/brands/category-label'
import { SaveBrandButton } from './save-brand-button'
import { BrandImageFallback } from './brand-image-fallback'
import { MitDeclaredBadge, MitVerifiedBadge, OwnerVerifiedBadge } from './brand-verification-badges'
import { cn } from '@/lib/utils'

interface BrandCardProps {
  brand: Brand
  position?: number
  preload?: boolean
  variant?: 'directory' | 'recommendation' | 'editorial'
  sourceBrandSlug?: string
  /**
   * Editorial variant only: the author's line about this brand, shown in place
   * of the generated blurb so a story's own voice wins over directory copy.
   */
  note?: string
  /** Editorial variant only: short kicker above the brand name. */
  eyebrow?: string
}

export function BrandCard({
  brand,
  position = 0,
  preload = false,
  variant = 'directory',
  sourceBrandSlug,
  note,
  eyebrow,
}: BrandCardProps) {
  const t = useTranslations('brands')
  const tDetail = useTranslations('brandDetail')
  const locale = useLocale()
  // Safe on surfaces with no SavedBrandsProvider — the hook falls back to an empty set.
  const { savedIds } = useSavedBrands()
  const [imgError, setImgError] = useState(false)
  const imageSrc =
    [brand.heroImageUrl, ...brand.productPhotos]
      .map((url) => safeImageSrc(url))
      .find((src): src is string => src !== null) ?? null
  const showImage = imageSrc !== null && !imgError

  const categoryLabel = getBrandCategoryLabel(brand, locale === 'en' ? 'en' : 'zh-TW')
  // The directory blurb, resolved once: both the directory variant and the
  // editorial variant (as its fallback when there is no curator note) render it,
  // and two copies of this chain drift apart the next time it changes.
  const blurb =
    locale === 'en'
      ? (brand.blurbEn ?? brand.descriptionEn ?? brand.blurb ?? brand.description)
      : (brand.blurb ?? brand.description)
  // Directory and editorial cards are whole-card click targets with a save
  // affordance; recommendation cards use an explicit button instead.
  const isWholeCardLink = variant === 'directory' || variant === 'editorial'

  return (
    <article
      className={surfaceCardStyles({
        className: 'group relative block shadow-card has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
        interactive: true,
        padding: 'none',
      })}
    >
      {/* Image */}
      <div className="relative z-10 aspect-[4/3] overflow-hidden rounded-t-xl bg-muted">
        {showImage ? (
          <Image
            src={imageSrc}
            alt=""
            fill
            preload={preload}
            className="object-contain transition-transform group-hover:scale-[1.02]"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            onError={() => setImgError(true)}
          />
        ) : (
          <BrandImageFallback name={brand.name} category={brand.category} size="card" />
        )}
        {isWholeCardLink ? (
          <SaveBrandButton brandId={brand.id} slug={brand.slug} variant="overlay" />
        ) : null}
      </div>

      {/* Content */}
      <div className="p-4">
        {variant === 'editorial' && eyebrow ? (
          /*
           * Micro-text, not a `Badge`: three grey pills across a `<BrandRow>`
           * read as chrome inside prose. `type-eyebrow-muted` is the declared
           * 11px uppercase tracked utility — never hand-pick the size here.
           */
          <p className="mb-2 type-eyebrow-muted">{eyebrow}</p>
        ) : null}
        <div className="flex min-w-0 items-center gap-1.5">
          {/*
           * Editorial titles get two lines with a reserved two-line height: at
           * the ~229px card width of a 3-up row `truncate` cut real brand names
           * mid-word, and an unreserved clamp let a 1-line card ride up out of
           * line with its neighbours. Every other variant keeps `truncate` —
           * the directory and recommendation surfaces must not change.
           */}
          <h3
            className={cn(
              'min-w-0 type-subsection-title',
              variant === 'editorial' ? 'line-clamp-2 min-h-10' : 'truncate',
            )}
          >
            <Link
              href={`/brands/${brand.slug}`}
              prefetch={variant === 'directory' ? false : undefined}
              className={cn(
                'focus-visible:outline-none',
                isWholeCardLink && 'after:absolute after:inset-0',
              )}
              onClick={() => {
                if (variant === 'recommendation') {
                  trackRecommendationBrandClicked(brand.id, brand.slug, sourceBrandSlug ?? '', position)
                } else {
                  trackBrandCardClicked(brand.slug, brand.category, position, brand.id)
                }
                if (savedIds.has(brand.id)) {
                  trackSavedBrandRevisited(brand.slug, 'card', brand.id)
                }
              }}
              data-ph-no-autocapture
            >
              {brand.name}
            </Link>
          </h3>
          {(brand.mitStatus === 'declared' || brand.mitStatus === 'verified' || brand.isVerified) && (
            <div className="flex shrink-0 items-center gap-1.5">
              {brand.mitStatus === 'declared' && (
                <MitDeclaredBadge
                  label={t('card.mitDeclaredBadge')}
                  title={tDetail('mitDeclaredTitle')}
                />
              )}
              {brand.mitStatus === 'verified' && (
                <MitVerifiedBadge
                  label={t('card.mitVerifiedBadge')}
                  title={tDetail('mitVerified')}
                />
              )}
              {brand.isVerified && (
                <OwnerVerifiedBadge
                  label={t('card.verifiedBadge')}
                  title={t('card.verifiedLabel')}
                />
              )}
            </div>
          )}
        </div>
        {variant === 'recommendation' ? (
          <>
            {categoryLabel ? (
              <p className="mt-1 truncate type-card-description">{categoryLabel}</p>
            ) : null}
            <Link
              href={`/brands/${brand.slug}`}
              className={buttonVariants({
                variant: 'secondary',
                className: 'relative z-20 mt-4 min-h-12 w-full',
              })}
              onClick={() => trackRecommendationBrandClicked(brand.id, brand.slug, sourceBrandSlug ?? '', position)}
              data-ph-no-autocapture
            >
              {t('card.viewBrand')}
            </Link>
          </>
        ) : variant === 'editorial' ? (
          <>
            {/*
              Same reserved block as the directory variant below: a fixed
              minimum height plus a two-line clamp so every card in a
              `<BrandGrid>` row lands its badge row on the same baseline,
              whatever length note the author wrote. Rendered unconditionally
              (with a space) for the same reason — a card without a note must
              still occupy the block, or it pulls its badges up out of line.
            */}
            {/*
              Curator note first, directory blurb second: a lineup card with no
              note said nothing about the brand at all, and the blurb is the
              same copy the directory card shows for it.
            */}
            <p className="mt-1.5 min-h-[2.625rem] type-body line-clamp-2">
              {note ?? blurb ?? ' '}
            </p>
            {categoryLabel ? (
              <div className="mt-3 flex items-center gap-1.5 overflow-hidden">
                <Badge variant="secondary">{categoryLabel}</Badge>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <p className="mt-1.5 min-h-[2.625rem] type-section-description line-clamp-2">
              {blurb ?? ' '}
            </p>
            <div className="mt-3 flex items-center gap-1.5 overflow-hidden">
              {categoryLabel && <Badge variant="secondary">{categoryLabel}</Badge>}
              {brand.priceRange != null && (
                <Badge variant="secondary">{'$'.repeat(brand.priceRange)}</Badge>
              )}
              {brand.productTags[0] && (
                <Badge variant="secondary" className="max-w-full truncate">
                  {locale === 'en'
                    ? (brand.productTagsEn[0] ?? brand.productTags[0])
                    : brand.productTags[0]}
                </Badge>
              )}
            </div>
          </>
        )}
      </div>
    </article>
  )
}
