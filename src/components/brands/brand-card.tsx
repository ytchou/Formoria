'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import type { Brand } from '@/lib/types'
import { trackBrandCardClicked } from '@/lib/analytics'

interface BrandCardProps {
  brand: Brand
  position?: number
}

export function BrandCard({ brand, position = 0 }: BrandCardProps) {
  const [imgError, setImgError] = useState(false)
  const imageSrc = brand.heroImageUrl ?? brand.logoUrl
  const showImage = imageSrc && !imgError

  return (
    <Link
      href={`/${brand.slug}`}
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
            className="object-cover transition-transform group-hover:scale-[1.02]"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            onError={() => setImgError(true)}
          />
        ) : (
          <div
            data-testid="image-fallback"
            className="flex h-full items-center justify-center bg-gradient-to-br from-secondary to-border"
          >
            <span className="text-2xl font-bold text-muted-foreground">
              {brand.name.charAt(0)}
            </span>
          </div>
        )}
        {/* Category overlay pill */}
        {brand.category && (
          <span className="absolute left-3 top-3 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-coffee">
            {brand.category}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        <h3 className="text-sm font-bold leading-snug text-foreground">
          {brand.name}
        </h3>
        {brand.description && (
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground line-clamp-2">
            {brand.description}
          </p>
        )}
        {brand.foundingYear && (
          <p className="mt-2 text-xs text-warm-caption">
            創立於 {brand.foundingYear}
          </p>
        )}
        {brand.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {brand.tags.slice(0, 3).map((tag) => (
              <span
                key={tag.id}
                className="inline-block rounded-full bg-muted px-3 py-1 text-[11px] font-medium text-secondary-foreground"
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
