import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import { Calendar, CircleDollarSign, MapPin, Package, ShieldCheck, Tag } from 'lucide-react'
import type { Brand } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { InfoField, SurfaceCard } from '@/components/ui/card'
import { Typography } from '@/components/ui/typography'
import { MitDeclaredBadge, MitVerifiedBadge, OwnerVerifiedBadge } from './brand-verification-badges'

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

      <section aria-labelledby="brand-info-heading" id="brand-info-section">
        <SurfaceCard>
          <Typography as="h2" id="brand-info-heading" variant="sectionTitle">
            {t('sectionTitle')}
          </Typography>
          <div className="mt-4 space-y-5">
            <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              <InfoField
                label={
                  <span className="flex items-center gap-2">
                    <MapPin aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    {t('label.location')}
                  </span>
                }
                value={cityLabel ? <Badge variant="secondary">{cityLabel}</Badge> : unknownValue}
              />
              <InfoField
                label={
                  <span className="flex items-center gap-2">
                    <Calendar aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    {t('label.foundingYear')}
                  </span>
                }
                value={
                  brand.foundingYear != null
                    ? t('foundingYear', { year: brand.foundingYear })
                    : unknownValue
                }
              />
            </dl>
            <hr className="border-border" />
            <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              <InfoField
                label={
                  <span className="flex items-center gap-2">
                    <Tag aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    {t('label.category')}
                  </span>
                }
                value={
                  resolvedCategory ? (
                    <Badge variant="secondary">{resolvedCategory}</Badge>
                  ) : (
                    unknownValue
                  )
                }
              />
              <InfoField
                label={
                  <span className="flex items-center gap-2">
                    <CircleDollarSign
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    {t('label.priceRange')}
                  </span>
                }
                value={
                  priceRangeLabel ? (
                    <Badge variant="secondary">{priceRangeLabel}</Badge>
                  ) : (
                    unknownValue
                  )
                }
              />
            </dl>
            <hr className="border-border" />
            <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              <InfoField
                label={
                  <span className="flex items-center gap-2">
                    <Package aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    {t('label.productCategories')}
                  </span>
                }
                value={
                  resolvedTags.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {resolvedTags.map((tag, index) => (
                        <Badge key={`${tag}-${index}`} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    unknownValue
                  )
                }
              />
              <InfoField
                label={
                  <span className="flex items-center gap-2">
                    <ShieldCheck
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    {t('label.certification')}
                  </span>
                }
                value={
                  hasVerification ? (
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
                  ) : (
                    unknownValue
                  )
                }
              />
            </dl>
          </div>
        </SurfaceCard>
      </section>
    </div>
  )
}
