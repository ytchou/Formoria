import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import type { Brand } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { MitDeclaredBadge, MitVerifiedBadge, OwnerVerifiedBadge } from './brand-verification-badges'

interface BrandHeaderProps {
  brand: Brand
  categoryLabel?: string | null
  cityLabel?: string | null
  locale?: string
  actionsSlot?: ReactNode
  adminSlot?: ReactNode
}

export function BrandHeader({ brand, categoryLabel, cityLabel, locale, actionsSlot, adminSlot }: BrandHeaderProps) {
  const t = useTranslations('brandDetail')
  const hasMitDeclaredBadge = brand.mitStatus === 'declared'
  const hasMitVerifiedBadge = brand.mitVerified === true && brand.mitStatus !== 'declared'
  const hasOwnerVerifiedBadge = brand.isVerified
  const mitSmileCert = hasMitVerifiedBadge ? brand.mitEvidence?.mit_smile_cert : undefined
  const priceRangeLabel = brand.priceRange != null ? '$'.repeat(brand.priceRange) : null

  return (
    <div className="space-y-3">
      {/* Brand name */}
      <div className="flex items-start justify-between gap-2">
        <h1 className="type-display">
          {brand.name}
        </h1>
        {adminSlot}
      </div>

      {/* CTA slot — rendered between name and meta row */}
      {actionsSlot}

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* City */}
        {cityLabel && (
          <span className="inline-flex items-center gap-1 type-caption">
            {cityLabel}
          </span>
        )}

        {/* Founding year */}
        {brand.foundingYear && (
          <span className="type-caption">
            {t('foundingYear', { year: brand.foundingYear })}
          </span>
        )}

        {/* Category pill */}
        {(categoryLabel ?? brand.category) && (
          <span className="rounded-full bg-primary/10 px-2 py-1 type-micro text-primary">
            {categoryLabel ?? brand.category}
          </span>
        )}

        {/* Price range pill */}
        {priceRangeLabel != null && (
          <span className="rounded-full bg-mit-verified-bg px-2 py-1 type-micro text-mit-verified">
            {priceRangeLabel}
          </span>
        )}

        {/* Product tags */}
        {brand.productTags.length > 0 &&
          (locale === 'en' ? (brand.productTagsEn.length > 0 ? brand.productTagsEn : brand.productTags) : brand.productTags).map((tag, index) => (
            <Badge key={`${tag}-${index}`} variant="secondary">
              {tag}
            </Badge>
          ))}

        {(hasMitDeclaredBadge || hasMitVerifiedBadge || hasOwnerVerifiedBadge) && (
          <div className="flex items-center gap-2">
            {hasMitDeclaredBadge && (
              <MitDeclaredBadge label={t('mitDeclared')} title={t('mitDeclaredTitle')} />
            )}
            {hasMitVerifiedBadge && (
              <MitVerifiedBadge label={t('mitVerified')} title={t('mitVerifiedTitle')} />
            )}
            {hasOwnerVerifiedBadge && (
              <OwnerVerifiedBadge label={t('verified')} title={t('verifiedTitle')} />
            )}
          </div>
        )}

        {/* MIT Smile cert number — plain caption, no link */}
        {mitSmileCert && (
          <span className="type-caption">
            {t('mitProofLink', { cert: mitSmileCert })}
          </span>
        )}
      </div>
    </div>
  )
}
