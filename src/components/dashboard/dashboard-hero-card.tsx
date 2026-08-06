import { getLocale, getTranslations } from 'next-intl/server'
import { ImageCarousel } from '@/components/brands/image-carousel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { InfoField, SurfaceCard } from '@/components/ui/card'
import { Typography } from '@/components/ui/typography'
import { CompletenessRing } from '@/components/dashboard/completeness-ring'
import { Link } from '@/i18n/navigation'
import { getProductTypeLabel } from '@/lib/brands/category-label'
import { getBrandGalleryImages } from '@/lib/services/brand-images'
import {
  computeProfileCompleteness,
  type ProfileCompleteness,
} from '@/lib/services/profile-completeness'
import type { OwnerBrandEditor } from '@/lib/brands/contracts'

const infoLabelClassName = 'type-field-label uppercase tracking-[0.08em]'

type DashboardHeroCardProps =
  | {
      brand: OwnerBrandEditor
      completeness: ProfileCompleteness
      completenessScore?: never
    }
  | {
      brand: OwnerBrandEditor
      completeness?: never
      completenessScore: number
    }

export async function DashboardHeroCard(props: DashboardHeroCardProps) {
  const { brand } = props
  const completeness = props.completeness ?? computeProfileCompleteness(brand)
  const [locale, tOverview, tMit, tBrandDetail, tCities] = await Promise.all([
    getLocale(),
    getTranslations('dashboard.overview'),
    getTranslations('dashboard.mit'),
    getTranslations('brandDetail'),
    getTranslations('cities'),
  ])
  const galleryImages = getBrandGalleryImages(brand)
  const mitStatus = brand.mitStatus ?? 'unverified'
  const publicationStatus = tOverview(
    brand.status === 'approved' ? 'statusPublished' : 'statusHidden',
  )
  const productType = brand.productType
    ? (getProductTypeLabel(
        brand.productType,
        locale === 'zh-TW' ? 'zh-TW' : 'en',
      ) ?? brand.productType)
    : '—'
  const priceRange = brand.priceRange != null ? '$'.repeat(brand.priceRange) : null
  const productTags = locale === 'en' && brand.productTagsEn.length > 0
    ? brand.productTagsEn
    : brand.productTags
  const unknownValue = (
    <Typography as="span" className="text-muted-foreground" variant="fieldValue">
      {tBrandDetail('unknown')}
    </Typography>
  )

  return (
    <SurfaceCard
      className="grid grid-cols-1 gap-6 rounded-lg md:grid-cols-[auto_1fr_auto]"
      padding="lg"
    >
      <div
        className="w-32 shrink-0 md:w-48"
        data-testid="hero-image"
      >
        <ImageCarousel
          alt={brand.name}
          brandId={brand.id}
          brandSlug={brand.slug}
          category={brand.productType ?? brand.category}
          imageAlts={brand.imageAlts}
          images={galleryImages}
          trackingEnabled={false}
          variant="compact"
        />
      </div>

      <div className="min-w-0" data-testid="hero-metadata">
        <div className="min-w-0">
          <h1 className="type-page-title">{brand.name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge
              variant={brand.status === 'approved' ? 'success' : 'secondary'}
            >
              {publicationStatus}
            </Badge>
            <Badge
              variant={
                mitStatus === 'verified'
                  ? 'verified'
                  : mitStatus === 'declared'
                    ? 'declared'
                    : 'secondary'
              }
            >
              {tMit(`status.${mitStatus}`)}
            </Badge>
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-1 gap-x-7 gap-y-4 sm:grid-cols-2">
          <InfoField
            label={tBrandDetail('label.location')}
            labelClassName={infoLabelClassName}
            value={brand.city ? (
              <Badge className="text-foreground" variant="secondary">
                {tCities(brand.city)}
              </Badge>
            ) : unknownValue}
          />
          <InfoField
            label={tBrandDetail('label.foundingYear')}
            labelClassName={infoLabelClassName}
            value={brand.foundingYear != null ? (
              <Badge className="text-foreground" variant="secondary">
                {brand.foundingYear}
              </Badge>
            ) : unknownValue}
          />
          <InfoField
            label={tBrandDetail('label.category')}
            labelClassName={infoLabelClassName}
            value={productType !== '—' ? (
              <Badge className="text-foreground" variant="secondary">
                {productType}
              </Badge>
            ) : unknownValue}
          />
          <InfoField
            label={tBrandDetail('label.priceRange')}
            labelClassName={infoLabelClassName}
            value={priceRange ? (
              <Badge className="text-foreground" variant="secondary">
                {priceRange}
              </Badge>
            ) : unknownValue}
          />
          <InfoField
            label={tBrandDetail('label.productCategories')}
            labelClassName={infoLabelClassName}
            value={productTags.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {productTags.map((productTag) => (
                  <Badge
                    className="text-foreground"
                    key={productTag}
                    variant="secondary"
                  >
                    {productTag}
                  </Badge>
                ))}
              </div>
            ) : unknownValue}
            wide
          />
        </dl>
      </div>

      <div
        className="flex flex-col items-center gap-3 md:w-52"
        data-testid="hero-completeness"
      >
        <p className="type-caption">{tOverview('completionTitle')}</p>
        <div className="[&_[role=img]]:size-20">
          <CompletenessRing score={completeness.score} />
        </div>
        <p className="type-caption">
          {tOverview('completedCount', {
            completed: completeness.completed,
            total: completeness.total,
          })}
        </p>
        {completeness.score < 100 ? (
          <p className="w-full rounded-lg bg-warning/10 p-3 type-caption text-warning">
            {tOverview('warningIncomplete', {
              count: completeness.recommendations.length,
            })}
          </p>
        ) : null}
        <Button
          className="min-h-12 w-full focus-visible:ring-2 focus-visible:ring-primary"
          nativeButton={false}
          render={
            <Link
              href={`/dashboard/brands/${brand.slug}#profile-completeness`}
            />
          }
          variant="secondary"
        >
          {tOverview('viewAllTodos')}
        </Button>
      </div>
    </SurfaceCard>
  )
}
