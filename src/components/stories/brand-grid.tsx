import { getTranslations } from 'next-intl/server'

import { BrandCard } from '@/components/brands/brand-card'
import { getBrandsBySlugs } from '@/lib/services/brands'
import { MissingBrandNotice } from './brand-card-mdx'

type BrandGridProps = {
  slugs: string[]
  /** Optional per-brand editorial note, keyed by slug. */
  notes?: Record<string, string>
}

/**
 * `<BrandGrid slugs={[…]} />` inside story MDX.
 *
 * One batched lookup for the whole array — rendering N `<BrandCardMdx>` would
 * be N queries. Two columns is the ceiling: the story column is 720px wide.
 */
export async function BrandGrid({ slugs, notes }: BrandGridProps) {
  if (slugs.length === 0) return null

  const brands = await getBrandsBySlugs(slugs)
  const t = await getTranslations('stories')

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {slugs.map((slug, index) => {
        const brand = brands.get(slug)
        const key = `${slug}-${index}`

        if (!brand) {
          return <MissingBrandNotice key={key} label={t('brandMissing', { slug })} />
        }

        return (
          <BrandCard
            key={key}
            brand={brand}
            variant="editorial"
            position={index}
            note={notes?.[slug]}
          />
        )
      })}
    </div>
  )
}
