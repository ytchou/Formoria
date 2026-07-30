import { getTranslations } from 'next-intl/server'

import { BrandCard } from '@/components/brands/brand-card'
import { getBrandsBySlugs } from '@/lib/services/brands'

type BrandCardMdxProps = {
  slug: string
  /** The author's own line about this brand, shown instead of the generated blurb. */
  note?: string
  /** Short kicker above the brand name, e.g. a section or theme label. */
  eyebrow?: string
}

/**
 * `<BrandCard slug="…" />` inside story MDX.
 *
 * Resolves through `getBrandsBySlugs`, never the throwing single-brand lookup:
 * a slug that was renamed or hidden after publication must degrade to an inline
 * placeholder, not throw and take the story page down.
 */
export async function BrandCardMdx({ slug, note, eyebrow }: BrandCardMdxProps) {
  const brands = await getBrandsBySlugs([slug])
  const brand = brands.get(slug)

  if (!brand) {
    const t = await getTranslations('stories')
    return <MissingBrandNotice label={t('brandMissing', { slug })} />
  }

  return <BrandCard brand={brand} variant="editorial" note={note} eyebrow={eyebrow} />
}

/**
 * Inert placeholder for an unresolvable slug. Deliberately not focusable and
 * not a link — there is nothing to navigate to, and a tab stop that goes
 * nowhere is worse than plain text.
 *
 * Takes the already-resolved label rather than calling `getTranslations` itself
 * so it stays a synchronous component: callers that render it in a list share
 * one translator lookup.
 */
export function MissingBrandNotice({ label }: { label: string }) {
  return (
    <p className="rounded-lg border border-dashed border-border px-4 py-3 type-body-muted">
      {label}
    </p>
  )
}
