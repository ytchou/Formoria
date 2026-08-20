import { getTranslations } from 'next-intl/server'

import { BrandCard } from '@/components/brands/brand-card'
import { Grid } from '@/components/ui/grid'
import { getPublicBrandsBySlugs } from '@/lib/services/brands'
import { normalizePublicBrandCard } from '@/lib/brands/contracts'
import { MissingBrandNotice, type BrandLoaderSeam } from './brand-card-mdx'

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
} & BrandLoaderSeam

/**
 * `<BrandGrid slugs={[…]} />` inside story MDX.
 *
 * One batched lookup for the whole array — rendering N `<BrandCardMdx>` would
 * be N queries. Two columns, not three: on a story this sits inside the
 * route's `prose-measure`, where two is all the width allows, and on a trail
 * inside `page-measure`, where three would fit and still be wrong — a grid
 * dropped into prose reads as a break in the argument, and two columns keeps
 * it closer to the text than to the directory.
 */
export async function BrandGrid({
  slugs,
  notes,
  startIndex = 0,
  loadBrands = getPublicBrandsBySlugs,
}: BrandGridProps) {
  if (slugs.length === 0) return null

  const brands = await loadBrands(slugs)
  const t = await getTranslations('stories')

  return (
    <Grid cols="pair">
      {slugs.map((slug, index) => {
        const resolvedBrand = brands.get(slug)
        const brand = resolvedBrand ? normalizePublicBrandCard(resolvedBrand) : undefined
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
    </Grid>
  )
}
