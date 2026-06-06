'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { trackGalleryPhotoView } from '@/lib/analytics'
import { safeImageSrc } from '@/lib/images/allowed-image-hosts'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'

interface BrandPhotoGalleryProps {
  photos: string[]
  brandSlug: string
}

export function BrandPhotoGallery({ photos, brandSlug }: BrandPhotoGalleryProps) {
  const validPhotos = photos.flatMap((photo) => {
    const safeSrc = safeImageSrc(photo)
    return safeSrc ? [safeSrc] : []
  })
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  const isOpen = selectedIndex !== null
  const total = validPhotos.length

  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : prev))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev !== null && prev < total - 1 ? prev + 1 : prev))
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, total])

  if (validPhotos.length === 0) return null

  return (
    <section>
      <h2 className="mb-3 font-[family-name:var(--font-heading)] text-lg font-bold text-foreground">
        Photos
      </h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {validPhotos.map((photo, i) => (
          <button
            key={i}
            type="button"
            className="relative aspect-[4/3] overflow-hidden rounded-lg bg-muted"
            onClick={() => {
              setSelectedIndex(i)
              trackGalleryPhotoView(brandSlug, i)
            }}
          >
            <Image
              src={photo}
              alt={`Product photo ${i + 1}`}
              fill
              sizes="(max-width: 640px) 50vw, 33vw"
              className="object-cover transition-opacity duration-300"
            />
          </button>
        ))}
      </div>

      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) setSelectedIndex(null)
        }}
      >
        <DialogContent
          className="max-w-4xl border-0 bg-black/95 p-0 ring-0"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">Photo viewer</DialogTitle>

          {selectedIndex !== null && (
            <div className="relative flex items-center justify-center">
              <button
                type="button"
                onClick={() => setSelectedIndex(null)}
                className="absolute right-2 top-2 z-10 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
                aria-label="Close photo viewer"
              >
                <X className="size-5" />
              </button>
              <div className="relative h-[80vh] w-full">
                <Image
                  src={validPhotos[selectedIndex]}
                  alt={`Product photo ${selectedIndex + 1}`}
                  fill
                  className="object-contain"
                  sizes="100vw"
                  priority
                />
              </div>

              {selectedIndex > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : prev))
                  }}
                  className="absolute left-2 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
                  aria-label="Previous photo"
                >
                  <ChevronLeft className="size-6" />
                </button>
              )}

              {selectedIndex < total - 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedIndex((prev) => (prev !== null && prev < total - 1 ? prev + 1 : prev))
                  }}
                  className="absolute right-2 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
                  aria-label="Next photo"
                >
                  <ChevronRight className="size-6" />
                </button>
              )}

              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
                {selectedIndex + 1} / {total}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
