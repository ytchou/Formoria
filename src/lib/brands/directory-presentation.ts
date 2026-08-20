import { buildCategoryTabTarget } from '@/components/navigation/category-tab-target'
import { localizePath } from '@/i18n/locale-preference'
import type { BrandSortOption } from '@/lib/pagination'
import type { DirectoryViewFilters } from '@/lib/seo/directory-filters'
import { directoryBrandCategoryFilter } from '@/lib/services/brands'
import { routes } from '@/lib/routes'

/**
 * The directory's presentation decisions, as pure functions over the parsed
 * filters. `DirectoryView` renders them; nothing here reaches for I/O, so each
 * rule is asserted directly instead of through the component.
 */

type DirectoryVerificationFilter = NonNullable<
  DirectoryViewFilters['verificationFilter']
>

/**
 * The L1 slugs a chip may claim.
 *
 * `directoryBrandCategoryFilter` is what the brand query conjoins, and it drops
 * the L1 entirely while an L2 is active — the L1 then only titles the page. A
 * chip derived from the raw selection instead would advertise a filter the
 * results do not obey: `/categories/bags-accessories/backpacks` legitimately
 * lists a `fashion` brand tagged `backpacks`. The count beside the filter box
 * obeys the same rule for free, because it counts the rows that query returned.
 */
export function directoryCategoryChipSlugs(
  categorySlugs: readonly string[],
  subcategorySlugs: readonly string[],
): string[] {
  return [...(directoryBrandCategoryFilter(categorySlugs, subcategorySlugs) ?? [])]
}

/**
 * Whether the page may publish the directory-wide `ItemList`.
 *
 * Any facet, any taxonomy selection, or any page past the first makes the page
 * `index:false` with a self-canonical, so an `ItemList` naming the directory
 * would describe a page Google is told not to index. `material` is a facet like
 * every other one here — it was the axis this predicate forgot.
 */
export function shouldEmitDirectoryItemList(input: {
  categorySlugs: readonly string[]
  search: string
  materials: readonly string[]
  priceRanges: readonly number[]
  verificationFilter: DirectoryVerificationFilter
  page: number
}): boolean {
  return (
    input.categorySlugs.length === 0 &&
    !input.search &&
    input.materials.length === 0 &&
    input.priceRanges.length === 0 &&
    input.verificationFilter === 'all' &&
    input.page === 1
  )
}

export type DirectoryUrlStateInput = {
  locale: string
  /** The single valid L1 the page is titled by, when there is one. */
  category?: { slug: string } | undefined
  /** The single resolved L2, when exactly one is active. */
  subcategory?: { slug: string; category: string } | undefined
  /** Valid L1 slugs: selection state, not necessarily what the query conjoins. */
  categorySlugs: readonly string[]
  /** Resolved L2 slugs. */
  subcategorySlugs: readonly string[]
  search: string
  materials: readonly string[]
  priceRanges: readonly number[]
  verificationFilter: DirectoryVerificationFilter
  sort: BrandSortOption
}

export type DirectoryUrlState = {
  locale: string
  /** The unlocalized surface this state lives on. */
  routePath: string
  /** `routePath` for the active locale. */
  directoryPath: string
  /** Every axis the URL carries, taxonomy included where the surface allows. */
  normalizedParams: URLSearchParams
  /** `normalizedParams` minus the taxonomy keys. */
  facetParams: URLSearchParams
}

/** Resolve the surface and query string this set of filters is addressed by. */
export function buildDirectoryUrlState(
  input: DirectoryUrlStateInput,
): DirectoryUrlState {
  // A sub whose parent L1 differs from the selected category has no
  // `/categories/<l1>/<l2>` address — `category-params.ts` still 404s that pair
  // and must keep doing so — so the whole view stays on `/brands` and both
  // facets stay in the query string.
  const subcategoryPairIsAddressable =
    !input.subcategory || input.subcategory.category === input.category?.slug
  const routePath = input.category && subcategoryPairIsAddressable
    ? routes.categoryPath(input.category.slug, input.subcategory?.slug)
    : routes.brands()
  const normalizedParams = new URLSearchParams()
  if (input.search) normalizedParams.set('search', input.search)
  if (input.categorySlugs.length > 0 && routePath === routes.brands()) {
    normalizedParams.set('category', input.categorySlugs.join(','))
  }
  if (input.subcategorySlugs.length > 0 && routePath === routes.brands()) {
    normalizedParams.set('sub', input.subcategorySlugs.join(','))
  }
  if (input.materials.length > 0) normalizedParams.set('material', input.materials.join(','))
  if (input.priceRanges.length > 0) normalizedParams.set('price', input.priceRanges.join(','))
  if (input.verificationFilter !== 'all') {
    normalizedParams.set('verification', input.verificationFilter)
  }
  if (input.sort !== 'random') normalizedParams.set('sort', input.sort)

  const facetParams = new URLSearchParams(normalizedParams)
  facetParams.delete('category')
  facetParams.delete('sub')

  return {
    locale: input.locale,
    routePath,
    directoryPath: localizePath(routePath, input.locale),
    normalizedParams,
    facetParams,
  }
}

/**
 * The URL for a taxonomy state, on whichever surface owns it.
 *
 * Taxonomy lives in the PATH on a category route and in the QUERY on `/brands`,
 * so a taxonomy chip cannot be removed by deleting a query key: on
 * `/categories/bags-accessories/backpacks` that patch resolves to the current
 * URL and the chip is a dead control. `buildCategoryTabTarget` is the one
 * resolver that renders a taxonomy state as a URL on either surface, and it is
 * given the facet-only query so an orthogonal facet survives the move.
 */
export function directoryTaxonomyHref(
  state: DirectoryUrlState,
  categorySlugs: readonly string[],
  subSlugs: readonly string[],
): string {
  return buildCategoryTabTarget({
    pathname: state.routePath,
    searchParams: state.facetParams.toString(),
    slug: categorySlugs[0] ?? '',
    categorySlugs: [...categorySlugs],
    subSlug: subSlugs.length > 0 ? subSlugs.join(',') : null,
    locale: state.locale,
  }).href
}
