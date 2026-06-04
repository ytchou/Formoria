import { useTranslations } from 'next-intl'
import { CheckCircle, MapPin } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Brand } from '@/lib/types'

interface BrandHeaderProps {
  brand: Brand
  actionsSlot?: ReactNode
}

export function BrandHeader({ brand, actionsSlot }: BrandHeaderProps) {
  const t = useTranslations('brandDetail')
  const locationName = brand.retailLocations[0]?.name

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
        {/* Category pill */}
        {brand.category && (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-foreground">
            {brand.category}
          </span>
        )}

        {/* Verified badge */}
        {brand.isVerified && (
          <span
            title="This brand has been verified by its owner"
            className="flex items-center gap-1 rounded-full bg-verified-green-bg px-2.5 py-1 text-[11px] font-semibold text-verified-green"
          >
            <CheckCircle className="size-3" aria-hidden />
            {t('verified')}
          </span>
        )}

        {/* Location */}
        {locationName && (
          <span className="flex items-center gap-1 text-xs text-warm-caption">
            <MapPin className="size-3.5" />
            {locationName}
          </span>
        )}

        {/* Founding year */}
        {brand.foundingYear && (
          <span className="text-xs text-warm-caption">
            {t('foundingYear', { year: brand.foundingYear })}
          </span>
        )}
      </div>
    </div>
  )
}
