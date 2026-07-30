import { getTranslations } from 'next-intl/server'

import { BrandCard } from '@/components/brands/brand-card'
import { getBrandsBySlugs } from '@/lib/services/brands'
import { MissingBrandNotice } from './brand-card-mdx'

type BrandGridProps = {
  slugs: string[]
  /** Optional per-brand editorial note, keyed by slug. */
  notes?: Record<string, string>
  /**
   * Rank of this grid's first card inside the story's single `view_item_list`
   * (`story:<slug>`); members are numbered from here.
   *
   * Ceiling: every grid otherwise indexes from 0, so a story with two grids
   * reports two different brands at `position_in_grid: 0` and GA4 rank analysis
   * mixes them. Shortcodes cannot see each other, so an author who cares passes
   * `startIndex` by hand. Upgrade path is the same as `BrandCardMdx`'s
   * `position`: a story-scoped counter threaded through `storyComponentMap`.
   */
  startIndex?: number
}

/**
 * `<BrandGrid slugs={[…]} />` inside story MDX.
 *
 * One batched lookup for the whole array — rendering N `<BrandCardMdx>` would
 * be N queries. Two columns is the ceiling: the story column is 720px wide.
 */
export async function BrandGrid({ slugs, notes, startIndex = 0 }: BrandGridProps) {
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
            position={startIndex + index}
            note={notes?.[slug]}
          />
        )
      })}
    </div>
  )
}
