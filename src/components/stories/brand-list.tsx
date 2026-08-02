import type { ReactNode } from 'react'

import { getTranslations } from 'next-intl/server'

import { getBrandsBySlugs } from '@/lib/services/brands'

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
 * `<div>`s rather than `<ul>`/`<li>`: an unresolvable slug degrades to
 * `MissingBrandNotice`, which is a `<p>`, and a `<p>` is not a legal child of
 * `<ul>`. Deliberately no card chrome — the list is part of the article, not a
 * module dropped into it.
 */
export function BrandList({ children }: BrandListProps) {
  return <div className="my-8 divide-y divide-border border-y border-border">{children}</div>
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
  loadBrands = getBrandsBySlugs,
}: BrandLineProps) {
  const brands = await loadBrands([slug])
  const brand = brands.get(slug)
  const t = await getTranslations('stories')

  if (!brand) {
    return <MissingBrandNotice label={t('brandMissing', { slug })} />
  }

  return (
    // Wrapping is flex + `gap`, never fixed column widths: at 375px a booth and
    // a note pinned to fixed columns overlap the moment the note runs long. The
    // note takes a full row of its own below the name on narrow screens and
    // shares the line from `sm` up.
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3">
      {booth ? (
        // `tabular-nums` so booth numbers form a straight column down the list
        // instead of ragging with the glyph widths. Secondary weight: the booth
        // is wayfinding, the brand name is the thing being recommended.
        <span className="shrink-0 tabular-nums type-metadata">
          {/* The bare code means nothing read aloud out of context. */}
          <span className="sr-only">{t('boothLabel')} </span>
          {booth}
        </span>
      ) : null}
      <BrandLineLink brand={brand} position={position} />
      {note ? (
        <span className="w-full min-w-0 type-body-muted sm:w-auto sm:flex-1">{note}</span>
      ) : null}
    </div>
  )
}
