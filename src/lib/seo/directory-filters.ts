import type { BrandFilters } from '@/lib/types'
import { parsePageParam, parseSortParam, type BrandSortOption } from '@/lib/pagination'
import { MATERIALS } from '@/lib/taxonomy/ontology'

export type DirectorySearchParams = Record<string, string | string[] | undefined>

export type DirectoryViewFilters = Pick<
  BrandFilters,
  'search' | 'materials' | 'verificationFilter'
> & {
  categorySlugs: string[]
  subcategorySlugs: string[]
}

const VALID_MATERIALS: ReadonlySet<string> = new Set(MATERIALS.map((m) => m.slug))

function parseCommaParam(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : []
  return values.flatMap((item) =>
    item
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
}

function parseVerificationParam(
  value: string | string[] | undefined,
): NonNullable<BrandFilters['verificationFilter']> {
  return value === 'mit-verified' || value === 'mit-declared' || value === 'owned' || value === 'all'
    ? value
    : 'all'
}

export function parseDirectoryViewFilters(
  searchParams: DirectorySearchParams,
  validCategorySlugs: ReadonlySet<string>,
): { filters: DirectoryViewFilters; page: number; sort: BrandSortOption } {
  const categorySlugs = parseCommaParam(searchParams.category)
    .filter((slug) => validCategorySlugs.has(slug))
  const singleCategory = categorySlugs.length === 1 ? categorySlugs[0] ?? null : null

  return {
    page: parsePageParam(searchParams.page),
    sort: parseSortParam(searchParams.sort),
    filters: {
      search: typeof searchParams.search === 'string' ? searchParams.search.trim() : '',
      categorySlugs,
      subcategorySlugs: singleCategory ? parseCommaParam(searchParams.sub) : [],
      // Closed vocabulary: an unknown term is dropped rather than passed to the
      // query, so `?material=xyz` cannot render a chip for a facet that filters
      // nothing. Unlike `sub` this is NOT scoped to a single category — material
      // is an orthogonal axis.
      //
      // Deduped as well as validated, mirroring the `seen` set in
      // `resolveDirectorySubcategorySlugs`. Membership is not multiplicity:
      // `?material=<term>,<term>,…` repeated 13 times passes every term and breaks
      // the RPC's `cardinality > 12` bound, which raises 22023 — and `getBrands`
      // swallows that into `{ brands: [], totalCount: 0 }`, so the page renders
      // empty with the chip still shown and only the server log records why.
      materials: [
        ...new Set(
          parseCommaParam(searchParams.material).filter((term) =>
            VALID_MATERIALS.has(term),
          ),
        ),
      ],
      verificationFilter: parseVerificationParam(searchParams.verification),
    },
  }
}
