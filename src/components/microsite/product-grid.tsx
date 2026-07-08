import Image from 'next/image'
import type { Brand, SiteProduct } from '@/lib/types/brand'

type ProductGridProps = {
  brand: Brand
  products: SiteProduct[]
}

export function ProductGrid({ brand, products }: ProductGridProps) {
  if (products.length === 0) {
    return null
  }

  return (
    <section className="px-6 py-12 md:px-10 md:py-16" aria-labelledby="microsite-products">
      <div className="mx-auto max-w-[1280px] space-y-6">
        <h2 id="microsite-products" className="type-section-title">
          精選商品
        </h2>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:gap-8 lg:grid-cols-3">
          {products.map((product) => (
            <article
              key={`${product.name}-${product.url ?? product.imageUrl ?? 'product'}`}
              className="group overflow-hidden rounded-xl border border-border bg-card transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)]"
            >
              {product.imageUrl && (
                <div className="relative aspect-[4/3] overflow-hidden rounded-t-xl bg-secondary">
                  <Image
                    src={product.imageUrl}
                    alt={`${brand.name} ${product.name}`}
                    fill
                    className="object-cover transition-transform group-hover:scale-[1.02]"
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  />
                </div>
              )}

              <div className="space-y-3 p-5">
                <div className="space-y-1.5">
                  <h3 className="type-subsection-title">
                    {product.name}
                  </h3>
                  {product.caption && (
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {product.caption}
                    </p>
                  )}
                </div>

                {product.url && (
                  <a
                    href={product.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-12 items-center justify-center rounded-lg border border-border px-4 py-3 type-subsection-title transition-colors hover:border-[var(--brand-accent)] hover:text-[var(--brand-accent)] active:scale-[0.98]"
                  >
                    查看商品
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
