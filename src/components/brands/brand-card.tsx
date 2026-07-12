'use client'

import { useState } from 'react'
import { Link } from '@/i18n/navigation'
import Image from 'next/image'
import { BadgeCheck, ShieldCheck, type LucideIcon } from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'
import type { Brand } from '@/lib/types'
import { trackBrandCardClicked } from '@/lib/analytics'
import { surfaceCardStyles } from '@/components/ui/card'
import { safeImageSrc } from '@/lib/images/allowed-image-hosts'
import { getBrandCategoryLabel } from '@/lib/brands/category-label'
import { SaveBrandButton } from './save-brand-button'
import { BrandImageFallback } from './brand-image-fallback'

interface BrandCardProps {
  brand: Brand
  position?: number
  priority?: boolean
}

type BrandCardBadge = {
  key: 'mit' | 'owner'
  label: string
  title: string
  className: string
  icon: LucideIcon
}

export function BrandCard({ brand, position = 0, priority = false }: BrandCardProps) {
  const t = useTranslations('brands')
  const tDetail = useTranslations('brandDetail')
  const locale = useLocale()
  const [imgError, setImgError] = useState(false)
  const imageSrc =
    [brand.heroImageUrl, ...brand.productPhotos]
      .map((url) => safeImageSrc(url))
      .find((src): src is string => src !== null) ?? null
  const showImage = imageSrc !== null && !imgError
  const badges = [
    brand.mitVerified === true
      ? {
          key: 'mit',
          label: t('card.mitVerifiedBadge'),
          title: tDetail('mitVerified'),
          className: 'bg-mit-verified-bg text-mit-verified',
          icon: ShieldCheck,
        }
      : null,
    brand.isVerified
      ? {
          key: 'owner',
          label: t('card.verifiedBadge'),
          title: t('card.verifiedLabel'),
          className: 'bg-verified-green-bg text-verified-green',
          icon: BadgeCheck,
        }
      : null,
  ].filter((badge): badge is BrandCardBadge => badge !== null)

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
        <SaveBrandButton brandId={brand.id} variant="overlay" />
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="flex min-w-0 items-center gap-1.5">
          <h3 className="min-w-0 truncate type-subsection-title">
            <Link
              href={`/brands/${brand.slug}`}
              className="after:absolute after:inset-0 focus-visible:outline-none"
              onClick={() => trackBrandCardClicked(brand.slug, brand.category, position)}
            >
              {brand.name}
            </Link>
          </h3>
          {badges.length > 0 && (
            <div className="flex shrink-0 items-center gap-1.5">
              {badges.map((badge) => {
                const Icon = badge.icon

                return (
                  <span
                    key={badge.key}
                    aria-label={badge.title}
                    title={badge.title}
                    className={`inline-flex items-center gap-[3px] rounded-full px-[7px] py-0.5 type-micro ${badge.className}`}
                  >
                    <Icon className="h-[9px] w-[9px]" aria-hidden />
                    {badge.label}
                  </span>
                )
              })}
            </div>
          )}
        </div>
        <p className="mt-1.5 min-h-[2.625rem] type-section-description line-clamp-2">
          {(locale === 'en'
            ? (brand.blurbEn ?? brand.descriptionEn ?? brand.blurb ?? brand.description)
            : (brand.blurb ?? brand.description)) ?? ' '}
        </p>
        <div className="mt-3 flex items-center gap-1.5 overflow-hidden">
          {categoryLabel && (
            <span className="shrink-0 rounded-full bg-secondary px-3 py-1 type-micro text-foreground whitespace-nowrap">
              {categoryLabel}
            </span>
          )}
          {brand.priceRange != null && (
            <span className="shrink-0 rounded-full bg-secondary px-2 py-1 type-micro text-foreground whitespace-nowrap">
              {'$'.repeat(brand.priceRange)}
            </span>
          )}
          {brand.productTags[0] && (
            <span className="truncate rounded-full bg-secondary px-3 py-1 type-micro text-foreground whitespace-nowrap">
              {locale === 'en' ? (brand.productTagsEn[0] ?? brand.productTags[0]) : brand.productTags[0]}
            </span>
          )}
        </div>
      </div>
    </article>
  )
}
