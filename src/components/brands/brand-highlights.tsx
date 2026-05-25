import type { Brand } from '@/lib/types'

interface Props {
  brand: Brand
}

export function BrandHighlights({ brand }: Props) {
  if (!brand.brandHighlights) return null
  return (
    <section>
      <h2 className="mb-3 font-heading text-base font-bold text-foreground">
        Brand Highlights
      </h2>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {brand.brandHighlights}
      </p>
    </section>
  )
}
