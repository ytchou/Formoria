'use client'

import { useState } from 'react'
import Image from 'next/image'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface ImageCarouselProps {
  images: string[]
  alt: string
}

export function ImageCarousel({ images, alt }: ImageCarouselProps) {
  const [current, setCurrent] = useState(0)
  const total = images.length

  if (total === 0) {
    return (
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-muted">
        <div className="flex h-full items-center justify-center">
          <span className="text-4xl font-bold text-muted-foreground">
            {alt.charAt(0)}
          </span>
        </div>
      </div>
    )
  }

  function goTo(index: number) {
    setCurrent(((index % total) + total) % total)
  }

  return (
    <div className="space-y-3">
      {/* Hero image */}
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-muted">
        <Image
          src={images[current]}
          alt={`${alt} — photo ${current + 1}`}
          fill
          className="object-cover"
          sizes="(max-width: 1024px) 100vw, 580px"
          priority={current === 0}
        />

        {total > 1 && (
          <>
            {/* Prev button */}
            <button
              type="button"
              className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-accent/80 p-2 text-accent-foreground backdrop-blur-sm transition-colors hover:bg-accent"
              onClick={() => goTo(current - 1)}
              aria-label="Previous image"
            >
              <ChevronLeft className="size-5" />
            </button>

            {/* Next button */}
            <button
              type="button"
              className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-accent/80 p-2 text-accent-foreground backdrop-blur-sm transition-colors hover:bg-accent"
              onClick={() => goTo(current + 1)}
              aria-label="Next image"
            >
              <ChevronRight className="size-5" />
            </button>

            {/* Counter badge */}
            <span className="absolute bottom-4 right-4 rounded-full bg-accent/80 px-2.5 py-1 text-xs font-medium text-accent-foreground backdrop-blur-sm">
              {current + 1} / {total}
            </span>
          </>
        )}
      </div>

      {/* Thumbnail grid */}
      {total > 1 && (
        <div className="flex gap-2 overflow-x-auto">
          {images.map((src, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setCurrent(i)}
              className={`relative size-16 shrink-0 overflow-hidden rounded-lg ${
                i === current
                  ? 'ring-2 ring-primary ring-offset-2'
                  : 'opacity-70 hover:opacity-100'
              }`}
              aria-label={`View photo ${i + 1}`}
            >
              <Image
                src={src}
                alt={`${alt} thumbnail ${i + 1}`}
                fill
                className="object-cover"
                sizes="64px"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
