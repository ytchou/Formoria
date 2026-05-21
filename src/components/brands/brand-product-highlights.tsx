import Image from 'next/image'
import type { Brand } from '@/lib/types'

interface BrandProductHighlightsProps {
  brand: Brand
}

export function BrandProductHighlights({ brand }: BrandProductHighlightsProps) {
  if (brand.productHighlights.length === 0) return null

  return (
    <section>
      <h2 className="mb-3 font-heading text-base font-bold text-foreground">
        Product Highlights
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {brand.productHighlights.map((product, i) => (
          <div
            key={i}
            className="overflow-hidden rounded-[10px] bg-secondary"
          >
            <div className="relative aspect-[4/3] bg-muted">
              {product.imageUrl ? (
                <Image
                  src={product.imageUrl}
                  alt={product.name}
                  fill
                  className="rounded-t-[10px] object-cover"
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 200px"
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <span className="text-2xl font-bold text-muted-foreground">
                    {product.name.charAt(0)}
                  </span>
                </div>
              )}
            </div>
            <div className="px-2.5 py-2">
              <p className="text-sm font-medium text-foreground">
                {product.name}
              </p>
              {product.description && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {product.description}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
