import { useTranslations } from 'next-intl'
import { MapPin } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Brand } from '@/lib/types'
import { MitVerifiedBadge, OwnerVerifiedBadge } from './brand-verification-badges'

interface BrandHeaderProps {
  brand: Brand
  categoryLabel?: string | null
  actionsSlot?: ReactNode
}

export function BrandHeader({ brand, categoryLabel, actionsSlot }: BrandHeaderProps) {
  const t = useTranslations('brandDetail')
  const locationName = brand.retailLocations[0]?.name
  const hasMitVerifiedBadge = brand.mitVerified === true
  const hasOwnerVerifiedBadge = brand.isVerified
  const mitSmileCert = hasMitVerifiedBadge ? brand.mitEvidence?.mit_smile_cert : undefined
  const priceRangeLabel = brand.priceRange != null ? '$'.repeat(brand.priceRange) : null

  return (
    <div className="space-y-3">
      {/* Brand name */}
      <h1 className="font-heading text-[26px] font-bold leading-tight text-foreground md:text-[32px]">
        {brand.name}
      </h1>

      {/* CTA slot — rendered between name and meta row */}
      {actionsSlot}

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {/* Founding year */}
        {brand.foundingYear && (
          <span className="text-xs text-warm-caption">
            {t('foundingYear', { year: brand.foundingYear })}
          </span>
        )}

        {/* Category pill */}
        {(categoryLabel ?? brand.category) && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            {categoryLabel ?? brand.category}
          </span>
        )}

        {/* Price range pill */}
        {priceRangeLabel != null && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
            {priceRangeLabel}
          </span>
        )}

        {/* Brand tags */}
        {brand.tags.map((tag) => (
          <span
            key={tag.id}
            className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground"
          >
            {tag.nameZh ?? tag.name}
          </span>
        ))}

        {/* Product tags */}
        {brand.productTags.length > 0 &&
          brand.productTags.map((tag, index) => (
            <span
              key={`${tag}-${index}`}
              className="rounded-full border border-muted-foreground/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
            >
              {tag}
            </span>
          ))}

        {(hasMitVerifiedBadge || hasOwnerVerifiedBadge) && (
          <div className="flex items-center gap-2">
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
          <span className="text-xs text-warm-caption">
            {t('mitProofLink', { cert: mitSmileCert })}
          </span>
        )}

        {/* Location */}
        {locationName && (
          <span className="flex items-center gap-1 text-xs text-warm-caption">
            <MapPin className="size-3.5" />
            {locationName}
          </span>
        )}
      </div>
    </div>
  )
}
