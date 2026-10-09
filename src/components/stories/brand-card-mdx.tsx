import { getTranslations } from 'next-intl/server'

import { BrandCard } from '@/components/brands/brand-card'
import { isStagingEnvironment } from '@/lib/deployment-environment'
import { getPublicBrandsBySlugs } from '@/lib/services/brands'
import { normalizePublicBrandCard, type PublicBrandCard } from '@/lib/brands/contracts'
import type { Brand } from '@/lib/types/brand'

type BrandCardMdxProps = {
  slug: string
  /** The author's own line about this brand, shown instead of the generated blurb. */
  note?: string
  /** Short kicker above the brand name, e.g. a section or theme label. */
  eyebrow?: string
  /**
   * Rank of this card inside the story's single `view_item_list`
   * (`story:<slug>`), reported to GA4 as `position_in_grid`.
   *
   * Ceiling: MDX shortcodes cannot see each other, so nothing derives a
   * page-wide sequence automatically — an author who wants clean rank analysis
   * passes `position` (and `<BrandGrid startIndex>`) by hand. Left unset every
   * card reports 0, which is at least honest about being unranked rather than
   * silently claiming first place. Upgrade path: thread a React context
   * provider from the story page through `storyComponentMap` and have each
   * shortcode take the next index from it.
   */
  position?: number
} & BrandLoaderSeam

/**
 * Test seam, not an authoring prop: MDX only ever passes strings, so this stays
 * `getBrandsBySlugs` in production. It exists so component tests can render
 * without a database and without mocking `@/lib/services/*`, which
 * `scripts/check-test-boundaries.mjs` forbids.
 */
export type BrandLoaderSeam = {
  loadBrands?: (slugs: string[]) => Promise<Map<string, Brand | PublicBrandCard>>
}

/**
 * `<BrandCard slug="…" />` inside story MDX.
 *
 * Resolves through `getBrandsBySlugs`, never the throwing single-brand lookup:
 * a slug that was renamed or hidden after publication must not throw and take
 * the story page down. It renders `MissingBrandNotice` in dev and on staging,
 * and nothing at all in production — see `shouldShowMissingBrandNotice`.
 */
export async function BrandCardMdx({
  slug,
  note,
  eyebrow,
  position,
  loadBrands = getPublicBrandsBySlugs,
}: BrandCardMdxProps) {
  const brands = await loadBrands([slug])
  const resolvedBrand = brands.get(slug)
  const brand = resolvedBrand ? normalizePublicBrandCard(resolvedBrand) : undefined

  if (!brand) {
    if (!shouldShowMissingBrandNotice()) return null
    const t = await getTranslations('stories')
    return <MissingBrandNotice label={t('brandMissing')} />
  }

  return (
    <BrandCard
      brand={brand}
      variant="editorial"
      note={note}
      eyebrow={eyebrow}
      position={position}
    />
  )
}

/**
 * Whether an unresolvable slug may render `MissingBrandNotice`: in local dev and
 * on staging (the preview environment), never in production.
 *
 * The notice is an authoring aid — it tells an editor a brand was renamed or
 * hidden. It never prints the raw slug (CP2-24); the editor has it in the MDX. Shipped to readers it is debugging text on a
 * published page (DEV-1963), so production drops the brand silently instead.
 * Read at call time, not module load, so tests can stub the environment.
 */
export function shouldShowMissingBrandNotice(): boolean {
  return process.env.NODE_ENV !== 'production' || isStagingEnvironment()
}

/**
 * Inert placeholder for an unresolvable slug, shown only where
 * `shouldShowMissingBrandNotice` allows. Deliberately not focusable and
 * not a link — there is nothing to navigate to, and a tab stop that goes
 * nowhere is worse than plain text.
 *
 * Takes the already-resolved label rather than calling `getTranslations` itself
 * so it stays a synchronous component: callers that render it in a list share
 * one translator lookup.
 */
export function MissingBrandNotice({ label }: { label: string }) {
  return (
    <p className="rounded-surface border border-dashed border-rule px-4 py-3 type-body-sm">
      {label}
    </p>
  )
}
