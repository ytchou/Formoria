import Image from 'next/image'
import type { PublicMicrositeBrand } from '@/lib/brands/contracts'
import { objectPositionStyle } from '@/lib/images/focal'

type HeroProps = {
  brand: PublicMicrositeBrand
  siteContent: Pick<PublicMicrositeBrand['siteContent'], 'tagline'>
}

export function Hero({ brand, siteContent }: HeroProps) {
  return (
    <section className="px-6 pt-12 md:px-10 md:pt-16">
      <div className="mx-auto grid max-w-[1280px] items-center gap-8 md:grid-cols-[minmax(0,0.85fr)_minmax(320px,1fr)] md:gap-12">
        <div className="space-y-5">
          <div className="space-y-3">
            <h1 className="type-display">
              {brand.name}
            </h1>
            {siteContent.tagline && (
      <p className="max-w-2xl type-body-muted">
                {siteContent.tagline}
              </p>
            )}
          </div>

          <a
            href="#contact"
            className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[var(--brand-accent)] px-6 py-3 text-sm font-semibold text-[var(--brand-accent-foreground)] transition-transform active:scale-[0.98]"
          >
            了解更多
          </a>
        </div>

        {brand.heroImageUrl && (
          <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-border bg-card">
            <Image
              src={brand.heroImageUrl}
              alt={brand.name}
              fill
              // Same carve-out as the brand card: a logo's whitespace is part
              // of the mark, so contain it rather than cover-cropping it.
              className={brand.isLogo ? 'object-contain p-6' : 'object-cover'}
              style={brand.isLogo ? undefined : { ...objectPositionStyle(brand) }}
              sizes="(max-width: 768px) 100vw, 50vw"
              preload
            />
          </div>
        )}
      </div>
    </section>
  )
}
