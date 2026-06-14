'use client'

import { useState } from 'react'
import { Link } from '@/i18n/navigation'
import Image from 'next/image'
import { BadgeCheck, ShieldCheck, type LucideIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { Brand } from '@/lib/types'
import { trackBrandCardClicked } from '@/lib/analytics'
import { safeImageSrc } from '@/lib/images/allowed-image-hosts'
import { getBrandCategoryLabel } from '@/lib/brands/category-label'
import { SaveBrandButton } from './save-brand-button'

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
  const [imgError, setImgError] = useState(false)
  const imageSrc =
    [brand.logoUrl, brand.heroImageUrl, ...brand.productPhotos]
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

  const categoryLabel = getBrandCategoryLabel(brand)
  const primaryCategoryTag = brand.tags.find((tag) => tag.category === 'product_type' && (
    tag.name === brand.category || tag.nameZh === brand.category
  )) ?? brand.tags.find((tag) => tag.category === 'product_type')
  const valueTags = brand.tags
    .filter((tag) => tag.id !== primaryCategoryTag?.id)
    .slice(0, 3)

  return (
    <Link
      href={`/brands/${brand.slug}`}
      className="group block rounded-xl border border-border bg-card shadow-[var(--shadow-card)] transition-all hover:-translate-y-px hover:shadow-[var(--shadow-card-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={brand.name}
      onClick={() => trackBrandCardClicked(brand.slug, brand.category, position)}
    >
      {/* Image */}
      <div className="relative aspect-[4/3] overflow-hidden rounded-t-xl bg-muted">
        {showImage ? (
          <Image
            src={imageSrc}
            alt={brand.name}
            fill
            priority={priority}
            className="object-cover transition-transform group-hover:scale-[1.02]"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            onError={() => setImgError(true)}
          />
        ) : (
          <div
            data-testid="image-fallback"
            className="flex h-full items-center justify-center bg-secondary"
          >
            <span className="text-2xl font-bold text-muted-foreground">
              {brand.name.charAt(0)}
            </span>
          </div>
        )}
        <SaveBrandButton brandId={brand.id} variant="overlay" />
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="flex min-w-0 items-center gap-1.5">
          <h3 className="min-w-0 truncate text-sm font-bold leading-snug text-foreground">
            {brand.name}
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
                    className={`inline-flex items-center gap-[3px] rounded-full px-[7px] py-0.5 font-sans text-[10px] font-semibold ${badge.className}`}
                  >
                    <Icon className="h-[9px] w-[9px]" aria-hidden />
                    {badge.label}
                  </span>
                )
              })}
            </div>
          )}
        </div>
        <p className="mt-1.5 min-h-[2.625rem] text-[13px] leading-relaxed text-muted-foreground line-clamp-2">
          {brand.description ?? ' '}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {/* Category — primary classification (filled) */}
          {categoryLabel && (
            <span className="inline-block rounded-full bg-secondary px-3 py-1 text-[11px] font-medium text-foreground">
              {categoryLabel}
            </span>
          )}
          {/* Tags — value classification (outlined) */}
          {valueTags.map((tag) => (
            <span
              key={tag.id}
              className="inline-block rounded-full border border-border bg-transparent px-3 py-1 text-[11px] font-medium text-warm-caption"
            >
              {tag.nameZh ?? tag.name}
            </span>
          ))}
        </div>
      </div>
    </Link>
  )
}
