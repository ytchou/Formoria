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

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_1fr] items-baseline gap-3">
      <span className="type-caption">{label}</span>
      <div>{children}</div>
    </div>
  )
}

export function BrandHeader({ brand, categoryLabel, cityLabel, locale, actionsSlot, adminSlot }: BrandHeaderProps) {
  const t = useTranslations('brandDetail')
  const hasMitDeclaredBadge = brand.mitStatus === 'declared'
  const hasMitVerifiedBadge = brand.mitStatus === 'verified'
  const hasOwnerVerifiedBadge = brand.isVerified
  const mitSmileCert = hasMitVerifiedBadge ? brand.mitEvidence?.mit_smile_cert : undefined
  const priceRangeLabel = brand.priceRange != null ? '$'.repeat(brand.priceRange) : null
  const resolvedTags = brand.productTags.length > 0
    ? (locale === 'en' ? (brand.productTagsEn.length > 0 ? brand.productTagsEn : brand.productTags) : brand.productTags)
    : []

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

      <div className="space-y-3">
        {(cityLabel || brand.foundingYear) && (
          <div className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
            {cityLabel && (
              <InfoRow label={t('label.location')}>
                <span className="text-sm">{cityLabel}</span>
              </InfoRow>
            )}
            {brand.foundingYear && (
              <InfoRow label={t('label.foundingYear')}>
                <span className="text-sm">{t('foundingYear', { year: brand.foundingYear })}</span>
              </InfoRow>
            )}
          </div>
        )}

        {((categoryLabel ?? brand.category) || priceRangeLabel) && (
          <div className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
            {(categoryLabel ?? brand.category) && (
              <InfoRow label={t('label.category')}>
                <span className="w-fit rounded-full bg-primary/10 px-2 py-1 type-micro text-primary">
                  {categoryLabel ?? brand.category}
                </span>
              </InfoRow>
            )}
            {priceRangeLabel && (
              <InfoRow label={t('label.priceRange')}>
                <span className="text-sm font-semibold tracking-wide text-primary">
                  {priceRangeLabel}
                </span>
              </InfoRow>
            )}
          </div>
        )}

        {resolvedTags.length > 0 && (
          <InfoRow label={t('label.productFeatures')}>
            <div className="flex flex-wrap gap-1.5">
              {resolvedTags.map((tag, index) => (
                <Badge key={`${tag}-${index}`} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
          </InfoRow>
        )}

        {(hasMitDeclaredBadge || hasMitVerifiedBadge || hasOwnerVerifiedBadge) && (
          <InfoRow label={t('label.manufacturing')}>
            <div className="flex flex-wrap items-center gap-2">
              {hasMitDeclaredBadge && (
                <MitDeclaredBadge label={t('mitDeclared')} title={t('mitDeclaredTitle')} />
              )}
              {hasMitVerifiedBadge && (
                <MitVerifiedBadge label={t('mitVerified')} title={t('mitVerifiedTitle')} />
              )}
              {hasOwnerVerifiedBadge && (
                <OwnerVerifiedBadge label={t('verified')} title={t('verifiedTitle')} />
              )}
              {mitSmileCert && (
                <span className="type-caption">
                  {t('mitProofLink', { cert: mitSmileCert })}
                </span>
              )}
            </div>
          </InfoRow>
        )}
      </div>
    </div>
  )
}
