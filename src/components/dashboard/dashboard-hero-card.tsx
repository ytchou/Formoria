import Image from 'next/image'
import { Calendar, CircleDollarSign, MapPin, Tag } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import { Badge } from '@/components/ui/badge'
import { SurfaceCard } from '@/components/ui/card'
import { getProductTypeLabel } from '@/lib/brands/category-label'
import { safeImageSrc } from '@/lib/images/allowed-image-hosts'
import type { Brand } from '@/lib/types'

export async function DashboardHeroCard({
  brand,
  completenessScore,
}: {
  brand: Brand
  completenessScore: number
}) {
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
    ? getProductTypeLabel(
        brand.productType,
        locale === 'zh-TW' ? 'zh-TW' : 'en',
      ) ?? brand.productType
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
    <SurfaceCard className="flex gap-5 md:gap-6" padding="lg">
      <div className="relative aspect-square w-32 shrink-0 overflow-hidden rounded-xl bg-muted md:w-48">
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

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="type-page-title">{brand.name}</h1>
            {brand.romanizedName ? (
              <p className="type-body-muted">{brand.romanizedName}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={brand.status === 'approved' ? 'success' : 'secondary'}>
              {publicationStatus} · {tMit(`status.${mitStatus}`)}
            </Badge>
            <span className="type-caption text-muted-foreground">
              {tOverview('completionTitle')} {completenessScore}%
            </span>
          </div>
        </div>

        {brand.description ? (
          <p className="mt-3 line-clamp-2 type-body-muted">{brand.description}</p>
        ) : null}

        <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {metadata.map(({ icon: Icon, value }, index) => (
            <div className="flex min-w-0 items-center gap-2 type-metadata" key={index}>
              <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
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
    </SurfaceCard>
  )
}
