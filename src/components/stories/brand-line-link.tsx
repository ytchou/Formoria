'use client'

import { Link } from '@/i18n/navigation'

import { trackBrandCardClicked } from '@/lib/analytics'
import type { PublicBrandCard } from '@/lib/brands/contracts'

type BrandLineLinkProps = {
  /** Already resolved by the server parent — this component never fetches. */
  brand: PublicBrandCard
  /** Rank inside the story's `view_item_list`; see `BrandLine`. */
  position?: number
}

/**
 * The clickable brand name inside a `<BrandLine>` row.
 *
 * A client island purely so the click can be measured. `BrandCardMdx` gets its
 * analytics for free because `BrandCard` is already a client component that
 * fires `trackBrandCardClicked` on its title link; a `BrandLine` is the same
 * thing — a brand link inside a story — so it must report the same event with
 * the same arguments, or the compact list layout would look like a drop in
 * brand engagement rather than a change of layout.
 *
 * The island is deliberately this small: the `Brand` is fetched and passed in
 * by the server component around it, so a list of ten lines is ten server-side
 * lookups feeding ten inert leaves, never ten client-side fetches.
 *
 * `trackSavedBrandRevisited` is NOT fired here, unlike `BrandCard`: that event
 * means "a reader returned to a brand they had saved", and it is only
 * meaningful next to a save affordance. A line has none.
 */
export function BrandLineLink({ brand, position = 0 }: BrandLineLinkProps) {
  return (
    <Link
      href={`/brands/${brand.slug}`}
      className="rounded-sm type-subsection-title underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => {
        trackBrandCardClicked(brand.slug, brand.category, position, brand.id)
      }}
      data-ph-no-autocapture
    >
      {brand.name}
    </Link>
  )
}
