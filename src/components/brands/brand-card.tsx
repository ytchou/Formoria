'use client'

import { useState } from 'react'
import { Link } from '@/i18n/navigation'
import Image from 'next/image'
import { CheckCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { Brand } from '@/lib/types'
import { trackBrandCardClicked } from '@/lib/analytics'

interface BrandCardProps {
  brand: Brand
  position?: number
  priority?: boolean
}

export function BrandCard({ brand, position = 0, priority = false }: BrandCardProps) {
  const t = useTranslations('brands')
  const [imgError, setImgError] = useState(false)
  const imageSrc = brand.heroImageUrl ?? brand.logoUrl
  const showImage = imageSrc && !imgError

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
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-bold leading-snug text-foreground">
            {brand.name}
          </h3>
          {brand.isVerified && (
            <span
              aria-label={t('card.verifiedLabel')}
              title={t('card.verifiedLabel')}
              className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold bg-verified-green-bg text-verified-green"
            >
              <CheckCircle className="h-3 w-3" aria-hidden />
              {t('card.verifiedBadge')}
            </span>
          )}
        </div>
        {brand.description && (
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground line-clamp-2">
            {brand.description}
          </p>
        )}
        {brand.foundingYear && (
          <p className="mt-2 text-xs text-warm-caption">
            {t('card.foundingYear', { year: brand.foundingYear })}
          </p>
        )}
        {(brand.category || brand.tags.length > 0) && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {/* Category — primary classification (filled) */}
            {brand.category && (
              <span className="inline-block rounded-full bg-secondary px-3 py-1 text-[11px] font-medium text-foreground">
                {brand.category}
              </span>
            )}
            {/* Tags — value classification (outlined) */}
            {brand.tags.slice(0, 3).map((tag) => (
              <span
                key={tag.id}
                className="inline-block rounded-full border border-border bg-transparent px-3 py-1 text-[11px] font-medium text-warm-caption"
              >
                {tag.nameZh ?? tag.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  )
}
