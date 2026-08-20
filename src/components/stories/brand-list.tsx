import type { ReactNode } from 'react'

import { getTranslations } from 'next-intl/server'

import { getPublicBrandsBySlugs } from '@/lib/services/brands'
import { normalizePublicBrandCard } from '@/lib/brands/contracts'

import { MissingBrandNotice, type BrandLoaderSeam } from './brand-card-mdx'
import { BrandLineLink } from './brand-line-link'

type BrandListProps = {
  /**
   * The rows, authored as plain `<BrandLine slug="…" />` shortcodes.
   *
   * Children, never a `slugs` array — MDX expression attributes (`slugs={[…]}`)
   * are silently dropped by the story pipeline (DEV-1302), so an array prop
   * arrives `undefined` at runtime. That is what left `BrandGrid` unusable from
   * MDX, and it is why `BrandRow` is children-based too. Do not add an array
   * prop here.
   */
  children?: ReactNode
}

/**
 * `<BrandList>…</BrandList>` inside story MDX: the compact counterpart to
 * `BrandRow`.
 *
 * Same information as a row of cards — booth, brand, one line of context — at a
 * fraction of the vertical weight, so a section can present its brands as a
 * scannable walking list instead of a third consecutive band of cards. A guide
 * that renders every section identically gives the reader no signal about which
 * sections are the deep ones; alternating layouts is that signal.
 *
 * A layout wrapper and nothing else, like `BrandRow`: it must not clone or
 * inspect its children (they are already-rendered `BrandLine` elements from the
 * MDX map). The hairline rules therefore come from `divide-y` on the container
 * rather than a border on each row, which keeps the DOM at one node per line.
 *
 * The column track lives here and each row opts into it with `grid-cols-subgrid`,
 * which is the only way to align columns across rows given that constraint: a
 * per-row grid sizes itself to its own content, so every note started at a
 * different x depending on how long that brand's name happened to be. Rules stay
 * horizontal only — column separators would turn an editorial list into a
 * spreadsheet.
 *
 * `<div>`s rather than `<ul>`/`<li>`: an unresolvable slug degrades to
 * `MissingBrandNotice`, which is a `<p>`, and a `<p>` is not a legal child of
 * `<ul>`. Deliberately no card chrome — the list is part of the article, not a
 * module dropped into it.
 */
export function BrandList({ children }: BrandListProps) {
  return (
    <div className="my-8 grid grid-cols-[auto_minmax(0,1fr)] divide-y divide-rule border-y border-rule sm:grid-cols-[auto_minmax(0,17rem)_minmax(0,1fr)]">
      {children}
    </div>
  )
}

type BrandLineProps = {
  /** Authored slug. May be a retired one — the lookup follows redirects. */
  slug: string
  /** Booth or stand number at the event, e.g. `A-12`. */
  booth?: string
  /** The author's one-line reason this brand is worth the walk. */
  note?: string
  /**
   * Rank of this line inside the story's single `view_item_list`
   * (`story:<slug>`), reported to GA4 as `position_in_grid`.
   *
   * Same ceiling and upgrade path as `BrandCardMdx.position`: MDX shortcodes
   * cannot see each other, so nothing derives a page-wide sequence
   * automatically. Left unset, every line reports 0 — honest about being
   * unranked rather than silently claiming first place.
   */
  position?: number
} & BrandLoaderSeam

/**
 * `<BrandLine slug="…" booth="A-12" note="…" />` — one row of a `<BrandList>`.
 *
 * Every authoring prop is a plain string, because MDX drops expression
 * attributes in this setup (DEV-1302); a shortcode that needs anything richer
 * is a shortcode that silently receives nothing.
 *
 * Resolves through `getBrandsBySlugs`, never the throwing single-brand lookup:
 * a slug renamed or hidden after publication must degrade to an inline
 * placeholder, not throw and take the whole story page down. That lookup also
 * follows `brand_slug_redirects`, which is why the rendered name and href come
 * from the RESOLVED brand rather than from `slug` — an authored slug can be the
 * old one, and linking to it would send readers through a redirect hop.
 *
 * Ceiling: one `getBrandsBySlugs` call per line, since a shortcode cannot see
 * its siblings and `BrandList` must not inspect its children. React `cache()`
 * collapses repeats of the *same* slug within a request but not distinct ones,
 * so a 10-line list is 10 lookups. Same shape as `BrandCardMdx`, and fine at
 * story scale; the upgrade path is the same context provider that would fix
 * `position` — hoist the slug set to the page (it already extracts them via
 * `extractBrandSlugs`) and hand each shortcode its pre-resolved brand.
 */
export async function BrandLine({
  slug,
  booth,
  note,
  position,
  loadBrands = getPublicBrandsBySlugs,
}: BrandLineProps) {
  const brands = await loadBrands([slug])
  const resolvedBrand = brands.get(slug)
  const brand = resolvedBrand ? normalizePublicBrandCard(resolvedBrand) : undefined
  const t = await getTranslations('stories')

  if (!brand) {
    return (
      <div className="col-span-full py-3">
        <MissingBrandNotice label={t('brandMissing', { slug })} />
      </div>
    )
  }

  return (
    // Inherits `BrandList`'s column track via `grid-cols-subgrid`, so booths,
    // names and notes line up down the whole list. Two columns at 375px — the
    // note drops to a full-width row of its own under the name — and three from
    // `sm` up, where it shares the line.
    <div className="col-span-full grid grid-cols-subgrid items-baseline gap-x-4 gap-y-1 py-3">
      {/* Always rendered, empty when there is no booth: an omitted cell would
          shift that row's remaining columns left and break the alignment the
          subgrid exists for. `tabular-nums` so the codes form a straight column
          instead of ragging with the glyph widths. Secondary weight — the booth
          is wayfinding, the brand name is the thing being recommended. */}
      <span className="shrink-0 tabular-nums type-metadata">
        {booth ? (
          <>
            {/* The bare code means nothing read aloud out of context. */}
            <span className="sr-only">{t('boothLabel')} </span>
            {booth}
          </>
        ) : null}
      </span>
      <BrandLineLink brand={brand} position={position} />
      {note ? (
        <span className="col-span-2 min-w-0 type-body-sm sm:col-span-1">{note}</span>
      ) : null}
    </div>
  )
}
