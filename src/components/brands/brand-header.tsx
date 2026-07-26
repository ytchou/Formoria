import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import type { Brand } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { InfoField } from '@/components/ui/card'
import { Typography } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import { MitDeclaredBadge, MitVerifiedBadge, OwnerVerifiedBadge } from './brand-verification-badges'
import { CorrectionSheet } from './correction-sheet'

const infoLabelClassName =
  'type-field-label uppercase tracking-[0.08em]'

interface BrandHeaderProps {
  brand: Brand
  categoryLabel?: string | null
  cityLabel?: string | null
  locale?: string
  actionsSlot?: ReactNode
  adminSlot?: ReactNode
}

export function BrandHeader({
  brand,
  categoryLabel,
  cityLabel,
  locale,
  actionsSlot,
  adminSlot,
}: BrandHeaderProps) {
  const t = useTranslations('brandDetail')
  const hasMitDeclaredBadge = brand.mitStatus === 'declared'
  const hasMitVerifiedBadge = brand.mitStatus === 'verified'
  const hasOwnerVerifiedBadge = brand.isVerified
  const hasVerification = hasMitDeclaredBadge || hasMitVerifiedBadge || hasOwnerVerifiedBadge
  const mitSmileCert = hasMitVerifiedBadge ? brand.mitEvidence?.mit_smile_cert : undefined
  const priceRangeLabel = brand.priceRange != null ? '$'.repeat(brand.priceRange) : null
  const resolvedCategory = categoryLabel ?? brand.category
  const resolvedTags =
    brand.productTags.length > 0
      ? locale === 'en'
        ? brand.productTagsEn.length > 0
          ? brand.productTagsEn
          : brand.productTags
        : brand.productTags
      : []
  const unknownValue = (
    <Typography as="span" className="text-muted-foreground" variant="fieldValue">
      {t('unknown')}
    </Typography>
  )

  return (
    <div>
      <div className="space-y-3">
        {/* Brand name */}
        <div className="flex items-start justify-between gap-4">
          <h1 className="type-display">
            {brand.name}
          </h1>
          {adminSlot}
        </div>

        {/* CTA slot — rendered between name and meta row */}
        {actionsSlot}
      </div>

      <section aria-labelledby="brand-info-heading" id="brand-info-section" className="mt-7">
        <Typography as="h2" id="brand-info-heading" variant="sectionTitleLarge">
          {t('sectionTitle')}
        </Typography>
        {hasVerification && (
          <div
            className={cn(
              'mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-3 py-2.5',
              hasMitVerifiedBadge ? 'bg-mit-verified-bg' : 'bg-secondary',
            )}
          >
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
        )}
        <dl className="mt-5 grid grid-cols-1 gap-x-7 gap-y-4 sm:grid-cols-2">
          <InfoField
            label={t('label.location')}
            labelClassName={infoLabelClassName}
            layout="stacked"
            value={
              cityLabel ? (
                <Badge className="text-foreground" variant="secondary">
                  {cityLabel}
                </Badge>
              ) : (
                unknownValue
              )
            }
          />
          <InfoField
            label={t('label.foundingYear')}
            labelClassName={infoLabelClassName}
            layout="stacked"
            value={
              brand.foundingYear != null
                ? t('foundingYear', { year: brand.foundingYear })
                : unknownValue
            }
          />
          <InfoField
            label={t('label.category')}
            labelClassName={infoLabelClassName}
            layout="stacked"
            value={
              <div className="flex items-center gap-2">
                {resolvedCategory ? (
                  <Badge className="text-foreground" variant="secondary">
                    {resolvedCategory}
                  </Badge>
                ) : (
                  unknownValue
                )}
                <CorrectionSheet
                  brandId={brand.id}
                  brandSlug={brand.slug}
                  field="product_type"
                  currentValue={brand.productType ?? null}
                />
              </div>
            }
          />
          <InfoField
            label={t('label.priceRange')}
            labelClassName={infoLabelClassName}
            layout="stacked"
            value={
              <div className="flex items-center gap-2">
                {priceRangeLabel ? (
                  <Badge className="text-foreground" variant="secondary">
                    {priceRangeLabel}
                  </Badge>
                ) : (
                  unknownValue
                )}
                <CorrectionSheet
                  brandId={brand.id}
                  brandSlug={brand.slug}
                  field="price_range"
                  currentValue={brand.priceRange}
                />
              </div>
            }
          />
          <InfoField
            label={t('label.productCategories')}
            labelClassName={infoLabelClassName}
            layout="stacked"
            value={
              resolvedTags.length > 0 || brand.productType != null ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {resolvedTags.length > 0
                    ? resolvedTags.map((tag, index) => (
                        <Badge
                          key={`${tag}-${index}`}
                          className="text-foreground"
                          variant="secondary"
                        >
                          {tag}
                        </Badge>
                      ))
                    : unknownValue}
                  {brand.productType != null && (
                    <CorrectionSheet
                      brandId={brand.id}
                      brandSlug={brand.slug}
                      field="product_tags"
                      currentValue={brand.productTags}
                      categorySlug={brand.productType}
                    />
                  )}
                </div>
              ) : (
                unknownValue
              )
            }
            wide
          />
          {!hasVerification && (
            <InfoField
              label={t('label.certification')}
              labelClassName={infoLabelClassName}
              layout="stacked"
              value={unknownValue}
              wide
            />
          )}
        </dl>
      </section>
    </div>
  )
}
