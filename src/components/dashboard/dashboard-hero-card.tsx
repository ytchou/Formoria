import Image from 'next/image'
import { Calendar, CircleDollarSign, MapPin, Tag } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SurfaceCard } from '@/components/ui/card'
import { CompletenessRing } from '@/components/dashboard/completeness-ring'
import { Link } from '@/i18n/navigation'
import { getProductTypeLabel } from '@/lib/brands/category-label'
import { safeImageSrc } from '@/lib/images/allowed-image-hosts'
import {
  computeProfileCompleteness,
  type ProfileCompleteness,
} from '@/lib/services/profile-completeness'
import type { Brand } from '@/lib/types'

type DashboardHeroCardProps =
  | {
      brand: Brand
      completeness: ProfileCompleteness
      completenessScore?: never
    }
  | {
      brand: Brand
      completeness?: never
      completenessScore: number
    }

export async function DashboardHeroCard(props: DashboardHeroCardProps) {
  const { brand } = props
  const completeness = props.completeness ?? computeProfileCompleteness(brand)
  const [locale, tOverview, tEdit, tMit] = await Promise.all([
    getLocale(),
    getTranslations('dashboard.overview'),
    getTranslations('dashboard.edit'),
    getTranslations('dashboard.mit'),
  ])
  const heroImage = safeImageSrc(brand.heroImageUrl)
  const mitStatus = brand.mitStatus ?? 'unverified'
  const publicationStatus = brand.status === 'approved' ? 'published' : 'hidden'
  const productType = brand.productType
    ? (getProductTypeLabel(
        brand.productType,
        locale === 'zh-TW' ? 'zh-TW' : 'en',
      ) ?? brand.productType)
    : '—'
  const priceRange = brand.priceRange
    ? tEdit(
        brand.priceRange === 1
          ? 'fieldPriceRangeBudget'
          : brand.priceRange === 2
            ? 'fieldPriceRangeMidRange'
            : 'fieldPriceRangePremium',
      )
    : '—'
  const metadata = [
    { icon: Calendar, value: brand.foundingYear ?? '—' },
    { icon: MapPin, value: brand.city ?? '—' },
    { icon: Tag, value: productType },
    { icon: CircleDollarSign, value: priceRange },
  ]

  return (
    <SurfaceCard
      className="grid grid-cols-1 gap-6 rounded-lg md:grid-cols-[auto_1fr_auto]"
      padding="lg"
    >
      <div
        className="relative aspect-square w-32 shrink-0 overflow-hidden rounded-lg bg-muted md:w-48"
        data-testid="hero-image"
      >
        {heroImage ? (
          <Image
            alt={brand.name}
            className="object-cover"
            fill
            sizes="(min-width: 768px) 192px, 128px"
            src={heroImage}
          />
        ) : (
          <div className="flex h-full items-center justify-center type-page-title text-muted-foreground">
            {brand.name.trim().charAt(0) || '?'}
          </div>
        )}
      </div>

      <div className="min-w-0" data-testid="hero-metadata">
        <div className="min-w-0">
          <h1 className="type-page-title">{brand.name}</h1>
          {brand.romanizedName ? (
            <p className="type-body-muted">{brand.romanizedName}</p>
          ) : null}
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

        <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {metadata.map(({ icon: Icon, value }, index) => (
            <div
              className="flex min-w-0 items-center gap-2 type-metadata"
              key={index}
            >
              <Icon
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
              <dd className="truncate">{value}</dd>
            </div>
          ))}
        </dl>

        {brand.productTags.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {brand.productTags.map((productTag) => (
              <Badge key={productTag} variant="secondary">
                {productTag}
              </Badge>
            ))}
          </div>
        ) : null}
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
