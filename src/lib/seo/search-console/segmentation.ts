/**
 * Search Console query and landing-page segmentation (DEV-1354).
 *
 * These pure classifiers keep Search Console reporting rows joinable to the
 * keyword ownership registry and the site's canonical URL shapes.
 */

import { PAGE_TYPES } from '../keyword-map'

export const QUERY_CLUSTERS = [
  'branded',
  'core-taiwan-brand',
  'cultural-creative',
  'craft-handmade',
  'design',
  'product-category',
  'english',
  'unclassified',
] as const

export type QueryCluster = (typeof QUERY_CLUSTERS)[number]

/**
 * The one ordered table that drives `classifyQuery`. First match wins, so order
 * is behaviour, not presentation:
 *
 * - `branded` is first: a query naming Formoria is branded even when it also
 *   matches a topic cluster.
 * - `design` sits ABOVE `core-taiwan-brand`. Every design literal ends in 品牌,
 *   which the core pattern also matches, so with the ticket's listed order the
 *   design cluster would be unreachable — no query could ever land in it.
 *   Specific-before-general is the only ordering that keeps all seven clusters
 *   addressable.
 */
export const CLUSTER_PATTERNS = [
  { cluster: 'branded', pattern: /formoria/ },
  { cluster: 'design', pattern: /(台灣|臺灣).*(設計品牌|原創品牌|獨立品牌)/ },
  { cluster: 'core-taiwan-brand', pattern: /(台灣|臺灣).*(品牌|目錄|平台|選物)/ },
  { cluster: 'cultural-creative', pattern: /(台灣|臺灣).*(文創|文化創意)/ },
  { cluster: 'craft-handmade', pattern: /(台灣|臺灣).*(工藝|手作|手工|職人)/ },
  {
    cluster: 'product-category',
    pattern: /(台灣|臺灣).*(包包|包袋|家具|居家|飾品|文具|服飾|手工皂|陶藝|餐具|寢具|收納)/,
  },
  { cluster: 'english', pattern: /taiwanese.*(brand|brands|directory|design|craft|handmade)/ },
] as const

export type QueryClassification = {
  raw: string
  normalized: string
  cluster: QueryCluster
}

export function normalizeQuery(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replaceAll('臺', '台')
}

export function classifyQuery(raw: string): QueryClassification {
  const normalized = normalizeQuery(raw)
  const match = CLUSTER_PATTERNS.find(({ pattern }) => pattern.test(normalized))

  return {
    raw,
    normalized,
    cluster: match?.cluster ?? 'unclassified',
  }
}

export const LANDING_PAGE_TYPES = [...PAGE_TYPES, 'event', 'other/static'] as const

export type LandingPageType = (typeof LANDING_PAGE_TYPES)[number]

export type LandingPageClassification = {
  raw: string
  path: string
  pageType: LandingPageType
}

const URL_BASE = 'https://formoria.invalid'

type ParsedLandingUrl = {
  path: string
  searchParams: URLSearchParams
}

function stripLocale(path: string): string {
  const withoutTrailingSlash = path.replace(/\/+$/, '') || '/'
  const withoutLocale = withoutTrailingSlash.replace(/^\/(?:en|zh-TW)(?=\/|$)/, '')

  return withoutLocale || '/'
}

function hasValue(searchParams: URLSearchParams, key: string): boolean {
  return searchParams.getAll(key).some((value) => value.trim().length > 0)
}

function parseLandingUrl(raw: string): ParsedLandingUrl {
  try {
    const url = new URL(raw, URL_BASE)
    return { path: stripLocale(url.pathname || '/'), searchParams: url.searchParams }
  } catch {
    const path = raw.split(/[?#]/u, 1).at(0) ?? '/'
    return { path: stripLocale(path), searchParams: new URLSearchParams() }
  }
}

function isSectionOrDescendant(path: string, section: string): boolean {
  return path === section || path.startsWith(`${section}/`)
}

export function classifyLandingPage(raw: string): LandingPageClassification {
  const { path, searchParams } = parseLandingUrl(raw)
  const hasCategory = hasValue(searchParams, 'category')
  const hasSubcategory = hasValue(searchParams, 'subcategory')

  let pageType: LandingPageType

  if (path === '/') {
    pageType = 'homepage'
  } else if (path === '/brands') {
    pageType = hasCategory && hasSubcategory
      ? 'l2-category'
      : hasCategory
        ? 'l1-category'
        : 'directory'
  } else if (path.startsWith('/brands/')) {
    pageType = 'brand-detail'
  } else if (isSectionOrDescendant(path, '/stories')) {
    pageType = 'story'
  } else if (isSectionOrDescendant(path, '/glossary')) {
    pageType = 'glossary'
  } else if (isSectionOrDescendant(path, '/stats')) {
    pageType = 'stats'
  } else if (isSectionOrDescendant(path, '/topics')) {
    pageType = 'topic-hub'
  } else if (isSectionOrDescendant(path, '/events')) {
    pageType = 'event'
  } else {
    pageType = 'other/static'
  }

  return { raw, path, pageType }
}
