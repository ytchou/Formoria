import { cache } from 'react'
import {
  PRODUCT_TYPE_CATEGORIES,
  subcategoryBySlug,
} from '@/lib/taxonomy/ontology'
import type { Locale } from './alternates'
import {
  buildDirectoryCanonicals,
  type DirectoryCanonicalFacets,
} from './directory-canonical'
import {
  DEFAULT_KEYWORD_MAP_PATH,
  loadKeywordMap,
  type Eligibility,
  type KeywordCluster,
  type KeywordMap,
} from './keyword-map'

/** Values from the parsed directory query string that determine indexation. */
export type DirectoryFacets = {
  [key: string]: unknown
  search?: unknown
  price?: unknown
  verification?: unknown
  sort?: unknown
  /** Raw values are accepted for callers that parse multi-select query params. */
  category?: unknown
  sub?: unknown
  multiCategory?: unknown
  multiSub?: unknown
}

export type DirectoryState = {
  locale: Locale
  /** The URL surface owns the taxonomy path when preserving facet queries. */
  surface?: 'brands' | 'category'
  categorySlug?: string | null
  subcategorySlug?: string | null
  page: number
  facets: DirectoryFacets
}

export type DirectoryRobots = {
  index: boolean
  follow: boolean
}

export type DirectorySeo = {
  canonical: string
  languages?: Record<string, string>
  robots?: DirectoryRobots
}

export type DirectoryTarget = {
  categorySlug: string
  subcategorySlug?: string
  pageType: 'l1-category' | 'l2-category'
  eligibility: Eligibility
}

// `loadKeywordMap` parses the complete YAML document and validates every row.
// Keep one module-level value in addition to React.cache: metadata and the
// page body call this resolver independently during one request, while a
// revalidation process should not parse the same registry over and over.
let keywordMapMemo: KeywordMap | undefined
const getKeywordMap = cache(() => {
  keywordMapMemo ??= loadKeywordMap(DEFAULT_KEYWORD_MAP_PATH)
  return keywordMapMemo
})

const CATEGORY_SLUGS = new Set<string>(
  PRODUCT_TYPE_CATEGORIES.map((category) => category.slug),
)

function taxonomyTarget(
  categorySlug: string | null | undefined,
  subcategorySlug: string | null | undefined,
): { categorySlug: string; subcategorySlug?: string } | null {
  if (!categorySlug || !CATEGORY_SLUGS.has(categorySlug)) return null
  if (!subcategorySlug) return { categorySlug }

  const subcategory = subcategoryBySlug(subcategorySlug)
  if (!subcategory || subcategory.category !== categorySlug) return { categorySlug }
  return { categorySlug, subcategorySlug }
}

function clusterForTarget(
  categorySlug: string,
  subcategorySlug?: string,
): KeywordCluster | undefined {
  const map = getKeywordMap()
  const pageType = subcategorySlug ? 'l2-category' : 'l1-category'
  return map.clusters.find(
    (cluster) =>
      cluster.locale === 'zh-TW' &&
      cluster.page_type === pageType &&
      cluster.ontology_slug === (subcategorySlug ?? categorySlug),
  )
}

/** Return whether a valid ontology target is marked `eligibility: launch`. */
export function isIndexableTarget(
  categorySlug: string,
  subcategorySlug?: string | null,
): boolean {
  if (subcategorySlug) {
    const subcategory = subcategoryBySlug(subcategorySlug)
    if (!subcategory || subcategory.category !== categorySlug) return false
  }
  const target = taxonomyTarget(categorySlug, subcategorySlug)
  if (!target) return false
  return clusterForTarget(target.categorySlug, target.subcategorySlug)?.eligibility === 'launch'
}

/** List the launch-eligible ontology targets advertised by the keyword map. */
export function listIndexableTargets(): DirectoryTarget[] {
  const map = getKeywordMap()
  const targets: DirectoryTarget[] = []

  for (const cluster of map.clusters) {
    if (
      cluster.locale !== 'zh-TW' ||
      cluster.eligibility !== 'launch' ||
      (cluster.page_type !== 'l1-category' && cluster.page_type !== 'l2-category') ||
      !cluster.ontology_slug
    ) {
      continue
    }

    if (cluster.page_type === 'l1-category') {
      if (!CATEGORY_SLUGS.has(cluster.ontology_slug)) continue
      targets.push({
        categorySlug: cluster.ontology_slug,
        pageType: cluster.page_type,
        eligibility: cluster.eligibility,
      })
      continue
    }

    const subcategory = subcategoryBySlug(cluster.ontology_slug)
    if (!subcategory || !CATEGORY_SLUGS.has(subcategory.category)) continue
    targets.push({
      categorySlug: subcategory.category,
      subcategorySlug: subcategory.slug,
      pageType: cluster.page_type,
      eligibility: cluster.eligibility,
    })
  }

  return targets
}

function hasValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'string') return value.trim().length > 0
  return Boolean(value)
}

function hasFacet(facets: DirectoryFacets): boolean {
  const verification =
    typeof facets.verification === 'string' ? facets.verification : undefined
  return (
    hasValue(facets.search) ||
    hasValue(facets.price) ||
    (hasValue(verification) && verification !== 'all') ||
    hasValue(facets.category) ||
    hasValue(facets.sub) ||
    hasValue(facets.multiCategory) ||
    hasValue(facets.multiSub)
  )
}

function hasSort(facets: DirectoryFacets): boolean {
  return hasValue(facets.sort)
}

function serializableFacetValue(value: unknown): unknown {
  return typeof value === 'string' ||
    typeof value === 'number' ||
    (Array.isArray(value) && value.every((item) => typeof item === 'string' || typeof item === 'number'))
    ? value
    : undefined
}

function selfCanonicalFacets(state: DirectoryState): DirectoryCanonicalFacets {
  const facets = state.facets ?? {}
  const category =
    serializableFacetValue(facets.category) ??
    serializableFacetValue(facets.multiCategory) ??
    (state.categorySlug && !CATEGORY_SLUGS.has(state.categorySlug)
      ? state.categorySlug
      : undefined)
  const sub =
    serializableFacetValue(facets.sub) ??
    serializableFacetValue(facets.multiSub) ??
    ((!state.categorySlug ||
      !subcategoryBySlug(state.subcategorySlug ?? '') ||
      subcategoryBySlug(state.subcategorySlug ?? '')?.category !== state.categorySlug) &&
    state.subcategorySlug
      ? state.subcategorySlug
      : undefined)
  const verification =
    typeof facets.verification === 'string' && facets.verification !== 'all'
      ? facets.verification
      : undefined

  return {
    search: serializableFacetValue(facets.search),
    price: serializableFacetValue(facets.price),
    verification,
    category,
    sub,
    sort: serializableFacetValue(facets.sort),
  }
}

function buildSelfCanonical(state: DirectoryState, preserveFacets = false): DirectorySeo {
  const facets = state.facets ?? {}
  const hasCategoryFacet =
    hasValue(facets.category) || hasValue(facets.multiCategory)
  const hasSubFacet = hasValue(facets.sub) || hasValue(facets.multiSub)
  const target = state.surface === 'category'
    ? taxonomyTarget(state.categorySlug, state.subcategorySlug)
    : preserveFacets && hasCategoryFacet
      ? null
      : taxonomyTarget(
          state.categorySlug,
          preserveFacets && hasSubFacet ? undefined : state.subcategorySlug,
        )
  const canonicals = buildDirectoryCanonicals({
    locale: state.locale,
    categorySlug: target?.categorySlug,
    subcategorySlug: target?.subcategorySlug,
    page: state.page,
    preserveFacets: preserveFacets ? selfCanonicalFacets(state) : undefined,
  })
  return canonicals
}

/**
 * Resolve the single directory indexation matrix. Facets deliberately win over
 * pagination and eligibility so noindex pages never point at a different
 * taxonomy URL; only a non-launch target gets a cross-canonical.
 */
export function resolveDirectorySeo(state: DirectoryState): DirectorySeo {
  const taxonomy = taxonomyTarget(state.categorySlug, state.subcategorySlug)
  const categoryWasSupplied = Boolean(state.categorySlug)
  const subWasSupplied = Boolean(state.subcategorySlug)
  const invalidCategory = categoryWasSupplied && !taxonomy
  const invalidSub =
    subWasSupplied &&
    (!state.categorySlug ||
      !subcategoryBySlug(state.subcategorySlug ?? '') ||
      subcategoryBySlug(state.subcategorySlug ?? '')?.category !== state.categorySlug)
  const facets = state.facets ?? {}
  const facetState = hasFacet(facets) || invalidCategory || invalidSub

  if (facetState) {
    return {
      ...buildSelfCanonical(state, true),
      robots: { index: false, follow: true },
    }
  }

  // Explicit sort is a presentation variant of the same indexable page. The
  // canonical builder intentionally has no sort parameter, so this branch can
  // return the same self-canonical while retaining normal indexability.
  if (hasSort(facets)) return buildSelfCanonical(state)

  // Pagination is self-canonical and keeps `page` (DEV-1329). It precedes the
  // eligibility downgrade by design, matching the matrix in the design doc.
  if (state.page > 1) return buildSelfCanonical(state)

  if (!taxonomy && !categoryWasSupplied && !subWasSupplied) {
    return buildSelfCanonical(state)
  }

  if (!taxonomy) {
    return {
      ...buildSelfCanonical(state),
      robots: { index: false, follow: true },
    }
  }

  if (isIndexableTarget(taxonomy.categorySlug, taxonomy.subcategorySlug)) {
    return buildSelfCanonical(state)
  }

  // A non-launch target is the only cross-canonical case. Omitting languages
  // prevents an unindexed page from claiming a reciprocal hreflang alternate.
  const parentCanonical = buildDirectoryCanonicals({
    locale: state.locale,
    categorySlug: taxonomy.subcategorySlug ? taxonomy.categorySlug : undefined,
  })
  return {
    canonical: parentCanonical.canonical,
    robots: { index: false, follow: true },
  }
}
