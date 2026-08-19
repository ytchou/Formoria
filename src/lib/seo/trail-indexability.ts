import { L2_SUBCATEGORIES } from '@/lib/taxonomy/ontology'

/** A trail needs the same minimum slate as the homepage's curated rail. */
export const MIN_TRAIL_PRODUCTS = 6

// The `*_l2` members keep the old vocabulary on purpose: they are emitted enum
// values consumed by downstream indexability reporting, not internal names.
// Renaming them is a data migration, not a refactor.
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
  category: string
  subcategories: readonly string[]
  sectionKey?: string | null
}

const VALID_SUBCATEGORIES = new Set(
  L2_SUBCATEGORIES.map((subcategory) => subcategory.slug),
)

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

  const subcategoryCounts = new Map<string, number>()
  const invalidSubcategories = new Set<string>()
  for (const product of products) {
    const productSubcategories = new Set(product.subcategories)
    for (const subcategory of productSubcategories) {
      if (!VALID_SUBCATEGORIES.has(subcategory)) {
        invalidSubcategories.add(subcategory)
        continue
      }
      subcategoryCounts.set(subcategory, (subcategoryCounts.get(subcategory) ?? 0) + 1)
    }
  }
  if (invalidSubcategories.size > 0) blockers.push('invalid_l2')

  if (subcategoryCounts.size < 2) blockers.push('distinct_l2')
  const largestSubcategoryCount = Math.max(0, ...subcategoryCounts.values())
  if (largestSubcategoryCount > products.length / 2) blockers.push('l2_dominance')

  return blockers
}
