'use client'

import { useState } from 'react'
import { Link } from '@/i18n/navigation'
import Image from 'next/image'
import { useTranslations, useLocale } from 'next-intl'
import type { Brand } from '@/lib/types'
import { trackBrandCardClicked } from '@/lib/analytics'
import { surfaceCardStyles } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { safeImageSrc } from '@/lib/images/allowed-image-hosts'
import { getBrandCategoryLabel } from '@/lib/brands/category-label'
import { SaveBrandButton } from './save-brand-button'
import { BrandImageFallback } from './brand-image-fallback'
import { MitVerifiedBadge, OwnerVerifiedBadge } from './brand-verification-badges'
import { cn } from '@/lib/utils'

interface BrandCardProps {
  brand: Brand
  position?: number
  priority?: boolean
  variant?: 'directory' | 'recommendation'
}

export function BrandCard({
  brand,
  position = 0,
  priority = false,
  variant = 'directory',
}: BrandCardProps) {
  const t = useTranslations('brands')
  const tDetail = useTranslations('brandDetail')
  const locale = useLocale()
  const [imgError, setImgError] = useState(false)
  const imageSrc =
    [brand.heroImageUrl, ...brand.productPhotos]
      .map((url) => safeImageSrc(url))
      .find((src): src is string => src !== null) ?? null
  const showImage = imageSrc !== null && !imgError

  const categoryLabel = getBrandCategoryLabel(brand, locale === 'en' ? 'en' : 'zh-TW')

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
            priority={priority}
            className="object-contain transition-transform group-hover:scale-[1.02]"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            onError={() => setImgError(true)}
          />
        ) : (
          <BrandImageFallback name={brand.name} category={brand.category} size="card" />
        )}
        {variant === 'directory' ? (
          <SaveBrandButton brandId={brand.id} variant="overlay" />
        ) : null}
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="flex min-w-0 items-center gap-1.5">
          <h3 className="min-w-0 truncate type-subsection-title">
            <Link
              href={`/brands/${brand.slug}`}
              className={cn(
                'focus-visible:outline-none',
                variant === 'directory' && 'after:absolute after:inset-0',
              )}
              onClick={() => trackBrandCardClicked(brand.slug, brand.category, position)}
            >
              {brand.name}
            </Link>
          </h3>
          {(brand.mitVerified === true || brand.isVerified) && (
            <div className="flex shrink-0 items-center gap-1.5">
              {brand.mitVerified === true && (
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
              onClick={() => trackBrandCardClicked(brand.slug, brand.category, position)}
            >
              {t('card.viewBrand')}
            </Link>
          </>
        ) : (
          <>
            <p className="mt-1.5 min-h-[2.625rem] type-section-description line-clamp-2">
              {(locale === 'en'
                ? (brand.blurbEn ?? brand.descriptionEn ?? brand.blurb ?? brand.description)
                : (brand.blurb ?? brand.description)) ?? ' '}
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
