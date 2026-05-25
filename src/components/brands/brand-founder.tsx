import type { Brand } from '@/lib/types'

interface BrandFounderProps {
  brand: Brand
}

export function BrandFounder({ brand }: BrandFounderProps) {
  if (!brand.founder) return null

  return (
    <section className="border-t border-border pt-6">
      <h2 className="mb-3 font-heading text-base font-bold text-foreground">
        Founder Story
      </h2>
      <div>
        <p className="text-sm font-semibold text-foreground">
          {brand.founder.name}
          {brand.founder.title && <span className="font-normal text-warm-caption"> · {brand.founder.title}</span>}
        </p>

        {brand.founder.quote && (
          <blockquote className="mt-2 border-l-2 border-ring pl-4 text-sm italic leading-snug text-muted-foreground">
            {brand.founder.quote}
          </blockquote>
        )}
      </div>
    </section>
  )
}
