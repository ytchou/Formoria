import { PRODUCT_SUBCATEGORIES } from '@/lib/taxonomy/ontology'

/** A trail needs the same minimum slate as the homepage's curated rail. */
export const MIN_TRAIL_PRODUCTS = 6

export type TrailIndexBlocker =
  | 'draft'
  | 'promise'
  | 'exclusions'
  | 'editorialOwner'
  | 'reviewedAt'
  | 'min_products'
  | 'empty_section'
  | 'l2_dominance'
  | 'distinct_l2'
  | 'invalid_l2'

export type TrailIndexabilityFrontmatter = {
  draft?: boolean
  promise?: string | null
  exclusions?: string | null
  editorialOwner?: string | null
  reviewedAt?: string | null
  sections: ReadonlyArray<{ key: string; title?: string }>
}

export type TrailIndexabilityProduct = {
  l1: string
  l2: readonly string[]
  sectionKey?: string | null
}

const VALID_L2 = new Set(PRODUCT_SUBCATEGORIES.map((subcategory) => subcategory.slug))

function present(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Returns every reason a trail must remain noindex. This is intentionally pure
 * so metadata, sitemap, and the admin readout all evaluate one gate.
 */
export function trailIndexBlockers({
  frontmatter,
  products,
}: {
  frontmatter: TrailIndexabilityFrontmatter
  products: readonly TrailIndexabilityProduct[]
}): TrailIndexBlocker[] {
  const blockers: TrailIndexBlocker[] = []

  if (frontmatter.draft) blockers.push('draft')
  if (!present(frontmatter.promise)) blockers.push('promise')
  if (!present(frontmatter.exclusions)) blockers.push('exclusions')
  if (!present(frontmatter.editorialOwner)) blockers.push('editorialOwner')
  if (!present(frontmatter.reviewedAt)) blockers.push('reviewedAt')
  if (products.length < MIN_TRAIL_PRODUCTS) blockers.push('min_products')

  const productSections = new Set(
    products
      .map((product) => product.sectionKey)
      .filter((sectionKey): sectionKey is string => present(sectionKey)),
  )
  if (frontmatter.sections.some((section) => !productSections.has(section.key))) {
    blockers.push('empty_section')
  }

  const l2Counts = new Map<string, number>()
  const invalidL2 = new Set<string>()
  for (const product of products) {
    const productL2 = new Set(product.l2)
    for (const l2 of productL2) {
      if (!VALID_L2.has(l2)) {
        invalidL2.add(l2)
        continue
      }
      l2Counts.set(l2, (l2Counts.get(l2) ?? 0) + 1)
    }
  }
  if (invalidL2.size > 0) blockers.push('invalid_l2')

  if (l2Counts.size < 2) blockers.push('distinct_l2')
  const largestL2Count = Math.max(0, ...l2Counts.values())
  if (largestL2Count > products.length / 2) blockers.push('l2_dominance')

  return blockers
}
