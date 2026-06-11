import Image from 'next/image'
import type { Brand, SiteContent } from '@/lib/types/brand'

type HeroProps = {
  brand: Brand
  siteContent: Pick<SiteContent, 'tagline'>
}

export function Hero({ brand, siteContent }: HeroProps) {
  return (
    <section className="px-6 pt-12 md:px-10 md:pt-16">
      <div className="mx-auto grid max-w-[1280px] items-center gap-8 md:grid-cols-[minmax(0,0.85fr)_minmax(320px,1fr)] md:gap-12">
        <div className="space-y-5">
          {brand.logoUrl && (
            <div className="relative h-16 w-16 overflow-hidden rounded-xl border border-border bg-card">
              <Image
                src={brand.logoUrl}
                alt={`${brand.name} logo`}
                fill
                className="object-contain p-2"
                sizes="64px"
                priority
              />
            </div>
          )}

          <div className="space-y-3">
            <h1 className="font-heading text-[26px] font-bold leading-tight text-foreground md:text-[32px]">
              {brand.name}
            </h1>
            {siteContent.tagline && (
              <p className="max-w-2xl text-sm leading-[1.7] text-muted-foreground md:text-base">
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
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 50vw"
              priority
            />
          </div>
        )}
      </div>
    </section>
  )
}
