'use client'

import { useState } from 'react'
import Image from 'next/image'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'
import { safeImageSrc } from '@/lib/images/allowed-image-hosts'
import { trackGalleryPhotoView } from '@/lib/analytics'
import { Button } from '@/components/ui/button'
import { BrandImageFallback } from './brand-image-fallback'

interface ImageCarouselProps {
  images: string[]
  alt: string
  brandId: string
  brandSlug: string
  category?: string | null
  imageAlts?: Array<{ altZh: string | null; altEn: string | null }>
}

export function ImageCarousel({ images, alt, brandId, brandSlug, category, imageAlts }: ImageCarouselProps) {
  const t = useTranslations('brandDetail')
  const locale = useLocale()
  const validImages = images.flatMap((image) => {
    const safeSrc = safeImageSrc(image)
    return safeSrc ? [safeSrc] : []
  })
  const [current, setCurrent] = useState(0)
  const [brokenImages, setBrokenImages] = useState<Set<number>>(new Set())
  const total = validImages.length

  const initial = [...alt][0]

  if (total === 0) {
    return (
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-muted">
        <BrandImageFallback name={alt} category={category ?? null} size="detail" />
      </div>
    )
  }

  function getAlt(index: number): string {
    if (imageAlts?.[index]) {
      const a = imageAlts[index]
      const localeAlt = locale === 'en' ? (a.altEn ?? a.altZh) : (a.altZh ?? a.altEn)
      if (localeAlt) return localeAlt
    }
    return t('gallery.photoAltWithBrand', { brand: alt, n: index + 1 })
  }

  function handleImageError(index: number) {
    setBrokenImages((prev) => new Set(prev).add(index))
  }

  function goTo(index: number) {
    const next = ((index % total) + total) % total
    setCurrent(next)
    if (next !== current) trackGalleryPhotoView(brandSlug, next, brandId)
  }

  const isCurrentBroken = brokenImages.has(current)

  return (
    <div className="space-y-3">
      {/* Hero image */}
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-muted">
        {isCurrentBroken ? (
          <BrandImageFallback name={alt} category={category ?? null} size="detail" />
        ) : (
          <Image
            src={validImages[current]}
            alt={getAlt(current)}
            fill
            className="object-contain"
            sizes="(max-width: 1024px) 100vw, 580px"
            priority={current === 0}
            onError={() => handleImageError(current)}
          />
        )}

        {total > 1 && (
          <>
            {/* Prev button */}
            <Button
              type="button"
              variant="overlay"
              shape="pill"
              size="icon"
              className="absolute left-4 top-1/2 -translate-y-1/2"
              onClick={() => goTo(current - 1)}
              aria-label={t('gallery.previous')}
            >
              <ChevronLeft className="size-5" />
            </Button>

            {/* Next button */}
            <Button
              type="button"
              variant="overlay"
              shape="pill"
              size="icon"
              className="absolute right-4 top-1/2 -translate-y-1/2"
              onClick={() => goTo(current + 1)}
              aria-label={t('gallery.next')}
            >
              <ChevronRight className="size-5" />
            </Button>

            {/* Counter badge */}
            <span className="absolute bottom-4 right-4 rounded-full bg-accent/80 px-2.5 py-1 type-field-label text-accent-foreground backdrop-blur-sm">
              {current + 1} / {total}
            </span>
          </>
        )}
      </div>

      {/* Thumbnail grid */}
      {total > 1 && (
        <div className="scrollbar-none flex gap-2 overflow-x-auto">
          {validImages.map((src, i) => (
            <Button
              key={i}
              type="button"
              variant="ghost"
              onClick={() => goTo(i)}
              className={`relative size-16 overflow-hidden rounded-lg p-0 hover:bg-transparent ${
                i === current
                  ? 'ring-2 ring-primary ring-offset-2'
                  : 'opacity-70 hover:opacity-100'
              }`}
              aria-label={t('gallery.viewPhoto', { n: i + 1 })}
            >
              {brokenImages.has(i) ? (
                <div className="flex h-full items-center justify-center bg-muted">
                  <span className="type-label text-muted-foreground">
                    {initial}
                  </span>
                </div>
              ) : (
                <Image
                  src={src}
                  alt={getAlt(i)}
                  fill
                  className="object-cover"
                  sizes="64px"
                  onError={() => handleImageError(i)}
                />
              )}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
