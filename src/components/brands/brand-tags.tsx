import { getTranslations } from 'next-intl/server'
import type { Brand } from '@/lib/types'

interface BrandTagsProps {
  brand: Brand
}

export async function BrandTags({ brand }: BrandTagsProps) {
  if (brand.tags.length === 0) return null

  const t = await getTranslations('brandDetail')

  return (
    <section>
      <h2 className="mb-3 font-heading text-base font-bold text-foreground">
        {t('sections.tags')}
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
