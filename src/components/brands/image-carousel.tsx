'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'
import { safeImageSrc } from '@/lib/images/allowed-image-hosts'
import { brandImageFill } from '@/lib/images/focal'
import type { BrandImageMeta } from '@/lib/types/brand'
import { trackGalleryPhotoView, trackGalleryCompleted } from '@/lib/analytics'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { BrandImageFallback } from './brand-image-fallback'
import { useBrandEngagement } from './brand-engagement-tracker'

interface ImageCarouselProps {
  images: string[]
  alt: string
  brandId: string
  brandSlug: string
  category?: string | null
  imageAlts?: BrandImageMeta[]
  variant?: 'detail' | 'compact'
  trackingEnabled?: boolean
}

export function ImageCarousel({
  images,
  alt,
  brandId,
  brandSlug,
  category,
  imageAlts,
  variant = 'detail',
  trackingEnabled = true,
}: ImageCarouselProps) {
  const t = useTranslations('brandDetail')
  const locale = useLocale()
  const { reportEngagement } = useBrandEngagement()
  // The source index rides along because `imageAlts` is index-aligned with the
  // unfiltered `images` prop: dropping an unsafe URL shifts every later
  // position, which silently handed the wrong alt (and now the wrong fill mode)
  // to every image after it.
  const validImages = images.flatMap((image, sourceIndex) => {
    const safeSrc = safeImageSrc(image)
    return safeSrc ? [{ src: safeSrc, sourceIndex }] : []
  })
  const [current, setCurrent] = useState(0)
  const [previous, setPrevious] = useState<number | null>(null)
  const [brokenImages, setBrokenImages] = useState<Set<number>>(new Set())
  const total = validImages.length
  const viewedIndices = useRef(new Set<number>([0]))
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const completedFired = useRef(false)

  const initial = [...alt][0]

  if (total === 0) {
    return (
      <div
        className={cn(
          'relative overflow-hidden rounded-xl bg-muted',
          variant === 'detail' ? 'aspect-[4/3]' : 'aspect-square',
        )}
      >
        <BrandImageFallback name={alt} category={category ?? null} size="detail" />
      </div>
    )
  }

  // Returns undefined for an out-of-range index rather than guessing. There is
  // no honest fallback: `imageAlts` is index-aligned with the UNFILTERED
  // `images` prop, so substituting the display index would hand back another
  // image's alt text and fill mode — the exact desync `sourceIndex` exists to
  // prevent. (The previous `?? index` fallback was unreachable while in range
  // and wrong out of it.)
  function metaFor(index: number): BrandImageMeta | undefined {
    const sourceIndex = validImages[index]?.sourceIndex
    return sourceIndex === undefined ? undefined : imageAlts?.[sourceIndex]
  }

  function getAlt(index: number): string {
    const a = metaFor(index)
    if (a) {
      const localeAlt = locale === 'en' ? (a.altEn ?? a.altZh) : (a.altZh ?? a.altEn)
      if (localeAlt) return localeAlt
    }
    return t('gallery.photoAltWithBrand', { brand: alt, n: index + 1 })
  }

  // Shared with every other brand image surface. The container already paints
  // the `bg-muted` plate a contained logo sits on, so no `logoPlate` here.
  function fill(index: number, inset: string) {
    return brandImageFill(metaFor(index), { inset })
  }

  const heroInset = variant === 'detail' ? 'p-6' : 'p-3'

  function handleImageError(index: number) {
    setBrokenImages((prev) => new Set(prev).add(index))
  }

  function goTo(index: number) {
    const next = ((index % total) + total) % total
    if (next === current) return
    clearTimeout(fadeTimerRef.current)
    setPrevious(current)
    setCurrent(next)
    viewedIndices.current.add(next)
    if (trackingEnabled) {
      trackGalleryPhotoView(brandSlug, next, brandId)
      reportEngagement('gallery')
      if (!completedFired.current && viewedIndices.current.size >= total) {
        completedFired.current = true
        trackGalleryCompleted(brandId, brandSlug, total)
      }
    }
    fadeTimerRef.current = setTimeout(() => setPrevious(null), 200)
  }

  const isCurrentBroken = brokenImages.has(current)
  /*
   * Bounds-guarded, not indexed directly.
   *
   * `current` and `previous` are `useState` indices while `validImages` is
   * recomputed from props on every render, so a prop change that shortens the
   * list leaves them pointing past the end. Reading `.src` off `undefined`
   * throws and takes the page down; on `main` the same expression merely passed
   * `undefined` through. A missing current image falls back to the same
   * placeholder a broken one gets, and a missing previous image simply skips
   * the cross-fade.
   */
  const currentImage = validImages[current]
  const previousImage =
    previous !== null && !brokenImages.has(previous) ? validImages[previous] : undefined
  // The hero CONTAINS rather than covers: both consumers of this carousel show
  // one product large (brand detail, dashboard hero card), so nothing neighbours
  // the image and there is no ragged-strip problem to solve — cropping would
  // only remove product. The thumbnails below still cover; they are small
  // indicative tiles where a uniform strip reads better than a row of
  // letterboxes. See DEV-1407.
  const currentFill = brandImageFill(metaFor(current), {
    inset: heroInset,
    fit: 'contain',
  })
  const previousFill = brandImageFill(previous === null ? undefined : metaFor(previous), {
    inset: heroInset,
    fit: 'contain',
  })

  return (
    <div className={cn(variant === 'detail' && 'space-y-3')}>
      {/* Hero image */}
      <div
        className={cn(
          'relative overflow-hidden rounded-xl bg-muted',
          variant === 'detail' ? 'aspect-[4/3]' : 'aspect-square',
        )}
      >
        {previousImage && (
          <Image
            src={previousImage.src}
            alt=""
            fill
            className={cn(
              'transition-opacity duration-200 opacity-0',
              previousFill.className,
            )}
            // Merged rather than assigned, because there IS another real
            // property here. The spread of a possibly-undefined
            // `previousFill.style` is safe in that case.
            style={{
              ...previousFill.style,
              transitionTimingFunction: 'var(--ease-settle)',
            }}
            sizes={variant === 'detail' ? '(max-width: 1024px) 100vw, 580px' : '192px'}
            aria-hidden
          />
        )}

        {isCurrentBroken || !currentImage ? (
          <BrandImageFallback name={alt} category={category ?? null} size="detail" />
        ) : (
          <Image
            key={current}
            src={currentImage.src}
            alt={getAlt(current)}
            fill
            className={cn('animate-in fade-in duration-200', currentFill.className)}
            // Assigned, never spread — `undefined` is meaningful here.
            style={currentFill.style}
            sizes={variant === 'detail' ? '(max-width: 1024px) 100vw, 580px' : '192px'}
            preload={variant === 'detail' && current === 0}
            onError={() => handleImageError(current)}
          />
        )}

        {total > 1 && (
          <>
            {/* Prev button */}
            <Button
              type="button"
              variant="secondary"
              shape="pill"
              size="icon"
              // The v2 `overlay` variant is gone with the second interaction
              // colour. Over a photograph an outline alone is illegible, so
              // the control wears a paper fill here — a call-site treatment,
              // not a new variant.
              className={cn(
                'absolute top-1/2 -translate-y-1/2 bg-ground/90 hover:bg-ground',
                variant === 'detail' ? 'left-4' : 'left-2',
              )}
              onClick={() => goTo(current - 1)}
              aria-label={t('gallery.previous')}
              data-ph-no-autocapture
            >
              <ChevronLeft className="size-5" />
            </Button>

            {/* Next button */}
            <Button
              type="button"
              variant="secondary"
              shape="pill"
              size="icon"
              className={cn(
                'absolute top-1/2 -translate-y-1/2 bg-ground/90 hover:bg-ground',
                variant === 'detail' ? 'right-4' : 'right-2',
              )}
              onClick={() => goTo(current + 1)}
              aria-label={t('gallery.next')}
              data-ph-no-autocapture
            >
              <ChevronRight className="size-5" />
            </Button>

            {/* Counter badge */}
            <span
              className={cn(
                'absolute rounded-full bg-accent/80 px-2.5 py-1 type-metadata text-accent-foreground backdrop-blur-sm',
                variant === 'detail' ? 'bottom-4 right-4' : 'bottom-2 right-2',
              )}
            >
              {current + 1} / {total}
            </span>
          </>
        )}
      </div>

      {/* Thumbnail grid */}
      {total > 1 && variant === 'detail' && (
        <div className="scrollbar-none flex gap-2 overflow-x-auto">
          {validImages.map(({ src }, i) => {
            const thumbFill = fill(i, 'p-1.5')
            return (
            <Button
              key={i}
              type="button"
              variant="ghost"
              onClick={() => goTo(i)}
              className={`relative size-16 overflow-hidden rounded-lg p-0 hover:bg-transparent ${
                i === current
                  ? 'ring-2 ring-accent ring-offset-2'
                  : 'opacity-70 hover:opacity-100'
              }`}
              aria-label={t('gallery.viewPhoto', { n: i + 1 })}
              data-ph-no-autocapture
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
                  className={thumbFill.className}
                  // Assigned, never spread — `undefined` is meaningful here.
                  style={thumbFill.style}
                  sizes="64px"
                  onError={() => handleImageError(i)}
                />
              )}
            </Button>
            )
          })}
        </div>
      )}
    </div>
  )
}
