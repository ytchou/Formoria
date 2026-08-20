/**
 * Search Console query and landing-page segmentation (DEV-1354).
 *
 * These pure classifiers keep Search Console reporting rows joinable to the
 * keyword ownership registry and the site's canonical URL shapes.
 */

// Imported from the dependency-free constants module, NOT from `../keyword-map`:
// that module pulls `node:fs`, `node:path`, `yaml` and `zod`, and the plan's
// performance budget forbids `yaml` reaching the client bundle. These
// classifiers are pure, so their import graph must stay pure too.
import type { PageType } from '../keyword-map-constants'
import { routes } from '@/lib/routes'

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
 * is behaviour, not presentation. Two rules govern it:
 *
 * 1. `branded` is first: a query naming Formoria is branded even when it also
 *    matches a topic cluster.
 * 2. Every other row is ordered SPECIFIC BEFORE GENERAL. `core-taiwan-brand` is
 *    the catch-all — its bare 品牌 alternative matches 台灣文創品牌, 台灣手作品牌
 *    and 台灣包包品牌 too — so it must sit BELOW every topic cluster it would
 *    otherwise swallow, or those clusters become unreachable configuration.
 *
 * Patterns are defined over NORMALIZED input (see `normalizeQuery`): lowercased,
 * NFKC-folded, whitespace-collapsed, and 臺 folded to 台. Never test them against
 * raw Search Console text — 臺灣品牌 will not match.
 */
export const CLUSTER_PATTERNS = [
  { cluster: 'branded', pattern: /formoria/ },
  { cluster: 'cultural-creative', pattern: /台灣.*(文創|文化創意)/ },
  { cluster: 'craft-handmade', pattern: /台灣.*(工藝|手作|手工|職人)/ },
  { cluster: 'design', pattern: /台灣.*(設計品牌|原創品牌|獨立品牌)/ },
  {
    cluster: 'product-category',
    pattern: /台灣.*(包包|包袋|家具|居家|飾品|文具|服飾|手工皂|陶藝|餐具|寢具|收納)/,
  },
  { cluster: 'core-taiwan-brand', pattern: /台灣.*(品牌|目錄|平台|選物)/ },
  {
    cluster: 'english',
    pattern: /taiwan(ese)?.*(brand|brands|directory|design|craft|handmade)/,
  },
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

export type LandingPageType = PageType | 'event' | 'other/static'

export type LandingPageClassification = {
  raw: string
  path: string
  pageType: LandingPageType
  /**
   * The stable key many raw URLs collapse onto, so performance can be grouped by
   * logical page rather than by URL string. Built from the locale-stripped,
   * trailing-slash-normalized path plus ONLY the indexable params, in fixed
   * order: `?category=<v>` then `&sub=<v>`. Ranking params (`page`, `sort`,
   * `q`, UTM) never appear.
   *
   * `/en/brands?category=bags&page=2` and `/brands?category=bags` therefore both
   * yield `/brands?category=bags`.
   */
  canonicalPage: string
}

/**
 * The two query params that identify a distinct indexable page. Everything else
 * on `/brands` is a ranking or pagination control and is dropped from the
 * canonical key.
 *
 * `sub` — not `subcategory` — is the real L2 param: `brand-filter-sidebar.tsx`
 * writes `{ sub: ... }`, `directory-filter-url.ts` types the key union with
 * `'sub'`, and `brands/page.tsx` reads it. `subcategory=` has zero hits in the
 * repo, so no legacy alias is accepted.
 */
const CATEGORY_PARAM = 'category'
const SUBCATEGORY_PARAM = 'sub'

type ParamValue = { kind: 'none' } | { kind: 'single'; value: string } | { kind: 'multi' }

/**
 * Both filter params are comma-separated multi-selects the app itself produces
 * (`join(',')` in the sidebar, `parseCommaParam` on read). A multi-value filter
 * is a filter VIEW, not a canonical category page — the registry models exactly
 * one row per ontology slug — so callers classify it as `directory`.
 */
function readParam(searchParams: URLSearchParams, key: string): ParamValue {
  const values = searchParams
    .getAll(key)
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

  if (values.length === 0) return { kind: 'none' }
  if (values.length > 1) return { kind: 'multi' }

  return { kind: 'single', value: values[0] as string }
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

/** Segments of `path` below `section`, e.g. ('/categories/home/lamps', '/categories') -> ['home', 'lamps']. */
function segmentsBelow(path: string, section: string): string[] {
  if (!isSectionOrDescendant(path, section)) return []
  return path.slice(section.length).split('/').filter(Boolean)
}

export function classifyLandingPage(raw: string): LandingPageClassification {
  const { path, searchParams } = parseLandingUrl(raw)
  const category = readParam(searchParams, CATEGORY_PARAM)
  const subcategory = readParam(searchParams, SUBCATEGORY_PARAM)
  // Only the filtered-directory branch carries a query in its canonical key;
  // everywhere else the path alone is the logical page. A canonical L1/L2 key
  // therefore always carries exactly one value per param — the multi-value forms
  // classify as `directory` (see `readParam`) and never reach it.
  let canonicalPage = path

  let pageType: LandingPageType

  if (path === '/') {
    pageType = 'homepage'
  } else if (path === routes.brands()) {
    if (category.kind === 'multi' || subcategory.kind === 'multi') {
      // Multi-select filter view: a `/brands` role, not a category page.
      pageType = 'directory'
    } else if (category.kind === 'single') {
      canonicalPage = `${path}?${CATEGORY_PARAM}=${category.value}`
      if (subcategory.kind === 'single') {
        canonicalPage += `&${SUBCATEGORY_PARAM}=${subcategory.value}`
        pageType = 'l2-category'
      } else {
        pageType = 'l1-category'
      }
    } else {
      // A bare `sub` with no category is not a page the app can produce.
      pageType = 'directory'
    }
  } else if (isSectionOrDescendant(path, routes.categories())) {
    // Proposed URL shape for the L1/L2 category pages a later ticket ratifies;
    // every l1-category and l2-category target_url in the committed map is here.
    // The path IS the canonical key — no filter params participate.
    const segments = segmentsBelow(path, routes.categories())
    pageType =
      segments.length === 1 ? 'l1-category' : segments.length === 2 ? 'l2-category' : 'other/static'
  } else if (path.startsWith(`${routes.brands()}/`)) {
    pageType = 'brand-detail'
  } else if (isSectionOrDescendant(path, routes.stories())) {
    pageType = 'story'
  } else if (isSectionOrDescendant(path, '/glossary')) {
    pageType = 'glossary'
  } else if (isSectionOrDescendant(path, '/stats')) {
    pageType = 'stats'
  } else if (isSectionOrDescendant(path, '/topics')) {
    pageType = 'topic-hub'
  } else if (isSectionOrDescendant(path, routes.events())) {
    pageType = 'event'
  } else {
    pageType = 'other/static'
  }

  return { raw, path, pageType, canonicalPage }
}
