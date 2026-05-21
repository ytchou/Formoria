import type { Brand } from '@/lib/types'

interface BrandTagsProps {
  brand: Brand
}

export function BrandTags({ brand }: BrandTagsProps) {
  if (brand.tags.length === 0) return null

  return (
    <section>
      <h2 className="mb-3 font-[family-name:var(--font-heading)] text-sm font-semibold text-foreground">
        Tags
      </h2>
      <div className="flex flex-wrap gap-2">
        {brand.tags.map((tag) => (
          <span
            key={tag.id}
            className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground"
          >
            {tag.nameZh ?? tag.name}
          </span>
        ))}
      </div>
    </section>
  )
}
