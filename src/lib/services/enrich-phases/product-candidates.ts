/**
 * Pure transforms for product candidate URLs: normalization, classification,
 * near-duplicate detection, and pool merging. Zero I/O.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UrlClass = 'product-detail' | 'listing' | 'other'

export type ProductCandidate = {
  url: string
  normalizedUrl: string
  title?: string
  imageUrl?: string
  supplier: string
  urlClass: UrlClass
  searchPosition?: number
}

// ---------------------------------------------------------------------------
// normalizeProductUrl
// ---------------------------------------------------------------------------

/** Query params to strip — tracking noise, not product identity. */
const STRIP_PARAMS = new Set([
  'srsltid',
  'fbclid',
  'gclid',
  'variant',
])

/** Prefix-matched params to strip. */
const STRIP_PREFIXES = ['utm_']

function shouldStripParam(key: string): boolean {
  if (STRIP_PARAMS.has(key)) return true
  return STRIP_PREFIXES.some((prefix) => key.startsWith(prefix))
}

/**
 * Normalizes a product URL for deduplication.
 *
 * - Lowercases the host (but preserves path case)
 * - Strips tracking params (`srsltid`, `utm_*`, `fbclid`, `gclid`, `variant`)
 * - Keeps product-identity params (`product_id`, `sid`, `goods_no`)
 * - Strips trailing slash
 * - Returns `null` on unparseable input (never throws)
 */
export function normalizeProductUrl(raw: string): string | null {
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  // Lowercase the host and strip leading www. so normalization agrees with
  // bareHost — without this, www.brand.tw/x and brand.tw/x normalize to
  // different strings and both survive URL-equality dedupe.
  url.hostname = url.hostname.toLowerCase().replace(/^www\./u, '')

  // Strip tracking params
  const keysToDelete: string[] = []
  url.searchParams.forEach((_value, key) => {
    if (shouldStripParam(key)) keysToDelete.push(key)
  })
  for (const key of keysToDelete) {
    url.searchParams.delete(key)
  }

  // Sort remaining params for stable comparison
  url.searchParams.sort()

  // Strip trailing slash from pathname
  if (url.pathname.endsWith('/') && url.pathname.length > 1) {
    url.pathname = url.pathname.slice(0, -1)
  }

  // Strip hash
  url.hash = ''

  // Build result without trailing slash on bare host
  let result = url.toString()
  if (result.endsWith('/')) {
    result = result.slice(0, -1)
  }

  return result
}

// ---------------------------------------------------------------------------
// classifyProductUrl
// ---------------------------------------------------------------------------

/**
 * Segment-based path patterns. Checked against individual path segments to
 * avoid substring false positives (e.g. `/product-care` must NOT match).
 */

/** Segments that indicate a listing page (no further slug). */
const LISTING_BARE_SEGMENTS = new Set(['products', 'shop', 'store', 'catalog'])

/** Segments that indicate a listing page when followed by a sub-path. */
const LISTING_PARENT_SEGMENTS = new Set(['collections', 'categories'])

/** Segments that indicate a product detail page when followed by a slug. */
const PRODUCT_PARENT_SEGMENTS = new Set([
  'products',
  'product',
  'item',
  'items',
  'goods',
])

/** Query params whose presence implies a product detail page. */
const PRODUCT_QUERY_PARAMS = ['product_id', 'goods_no', 'item_id']

/**
 * Classifies a URL as `product-detail`, `listing`, or `other`.
 *
 * LISTING patterns are checked BEFORE product patterns so that bare
 * `/products` (no slug) classifies as `listing`, not `product-detail`.
 *
 * Matching is path-segment based — `/product-care` does NOT match.
 */
export function classifyProductUrl(raw: string): UrlClass {
  if (!raw) return 'other'

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return 'other'
  }

  // Split path into clean segments (drop empty strings from leading/trailing slashes)
  const segments = url.pathname.split('/').filter(Boolean)

  // --- Listing checks (BEFORE product checks) ---

  // Bare listing segments with no further path: /products, /shop, /store, /catalog
  if (segments.length === 1 && LISTING_BARE_SEGMENTS.has(segments[0])) {
    return 'listing'
  }

  // Listing parent segments: /collections/*, /categories/*
  if (segments.length >= 1 && LISTING_PARENT_SEGMENTS.has(segments[0])) {
    return 'listing'
  }

  // --- Product detail checks ---

  // Product parent segments with a slug: /products/<slug>, /product/<slug>, /item/<slug>
  if (segments.length >= 2 && PRODUCT_PARENT_SEGMENTS.has(segments[0])) {
    return 'product-detail'
  }

  // Query param implies product detail
  if (PRODUCT_QUERY_PARAMS.some((p) => url.searchParams.has(p))) {
    return 'product-detail'
  }

  return 'other'
}

// ---------------------------------------------------------------------------
// dedupeNearDuplicates
// ---------------------------------------------------------------------------

/**
 * Strips a trailing variant/colour suffix so two colourways of one product
 * compare as equal. Recognised separators: ` - `, ` | `, trailing `(...)`.
 *
 * "Ergonomic Office Chair - Midnight Blue" → "Ergonomic Office Chair"
 * "Ceramic Bowl (Large)"                  → "Ceramic Bowl"
 * "Standing Desk"                         → "Standing Desk" (unchanged)
 */
function stripVariantSuffix(title: string): string {
  const dashIdx = title.lastIndexOf(' - ')
  if (dashIdx > 0) return title.slice(0, dashIdx)

  const pipeIdx = title.lastIndexOf(' | ')
  if (pipeIdx > 0) return title.slice(0, pipeIdx)

  const parenMatch = title.match(/^(.+)\s+\([^)]+\)\s*$/)
  if (parenMatch) return parenMatch[1]

  // CJK fullwidth dash (U+FF0D)
  const fwDashIdx = title.lastIndexOf('－')
  if (fwDashIdx > 0) return title.slice(0, fwDashIdx).trimEnd()

  // CJK fullwidth pipe (U+FF5C)
  const fwPipeIdx = title.lastIndexOf('｜')
  if (fwPipeIdx > 0) return title.slice(0, fwPipeIdx).trimEnd()

  // CJK lenticular brackets 【...】
  const bracketMatch = title.match(/^(.+)【[^】]+】\s*$/)
  if (bracketMatch) return bracketMatch[1].trimEnd()

  return title
}

/**
 * Simple bigram-based similarity for short titles. Returns a value in [0, 1].
 */
function bigramSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0

  const lower_a = a.toLowerCase()
  const lower_b = b.toLowerCase()

  const bigramsA = new Set<string>()
  for (let i = 0; i < lower_a.length - 1; i++) {
    bigramsA.add(lower_a.slice(i, i + 2))
  }

  const bigramsB = new Set<string>()
  for (let i = 0; i < lower_b.length - 1; i++) {
    bigramsB.add(lower_b.slice(i, i + 2))
  }

  let intersection = 0
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++
  }

  return (2 * intersection) / (bigramsA.size + bigramsB.size)
}

const TITLE_SIMILARITY_THRESHOLD = 0.85

/**
 * Two titles are near-duplicates when either:
 * 1. Their core (after stripping a trailing variant/colour suffix) is
 *    case-insensitively identical — catches "Product - Blue" vs "Product - Red".
 * 2. Their full-string bigram similarity >= 0.85.
 */
function titlesAreNearDuplicate(a: string, b: string): boolean {
  // Path 1: variant-suffix stripping — the core product name matches
  const coreA = stripVariantSuffix(a).toLowerCase()
  const coreB = stripVariantSuffix(b).toLowerCase()
  if (coreA === coreB && coreA.length > 0) return true

  // Path 2: raw bigram similarity for cases without a clear separator
  return bigramSimilarity(a, b) >= TITLE_SIMILARITY_THRESHOLD
}

/**
 * Collapses near-duplicates: normalized-URL equality OR title near-duplicate.
 * Keeps the first occurrence (lowest index, which is typically lowest search position).
 */
export function dedupeNearDuplicates(
  candidates: ProductCandidate[]
): { kept: ProductCandidate[]; collapsedCount: number } {
  const kept: ProductCandidate[] = []
  let collapsedCount = 0

  for (const candidate of candidates) {
    const isDuplicate = kept.some((existing) => {
      // Normalized URL equality
      if (existing.normalizedUrl === candidate.normalizedUrl) return true

      // URL-distinctness override: distinct URLs = distinct products
      if (existing.normalizedUrl && candidate.normalizedUrl) return false

      // Title near-duplicate (only when both have titles)
      if (existing.title && candidate.title) {
        if (titlesAreNearDuplicate(existing.title, candidate.title)) {
          return true
        }
      }

      return false
    })

    if (isDuplicate) {
      collapsedCount++
    } else {
      kept.push(candidate)
    }
  }

  return { kept, collapsedCount }
}

// ---------------------------------------------------------------------------
// mergeCandidatePool
// ---------------------------------------------------------------------------

export type MergedCandidatePool = {
  products: ProductCandidate[]
  listings: ProductCandidate[]
}

/**
 * Splits candidates by class, drops `other`, and sorts products by
 * `searchPosition` (ascending, nulls last).
 */
export function mergeCandidatePool(
  candidates: ProductCandidate[]
): MergedCandidatePool {
  const products: ProductCandidate[] = []
  const listings: ProductCandidate[] = []

  for (const c of candidates) {
    if (c.urlClass === 'product-detail') {
      products.push(c)
    } else if (c.urlClass === 'listing') {
      listings.push(c)
    }
    // 'other' is dropped
  }

  // Sort products by searchPosition ascending, nulls last
  products.sort((a, b) => {
    const posA = a.searchPosition ?? Number.MAX_SAFE_INTEGER
    const posB = b.searchPosition ?? Number.MAX_SAFE_INTEGER
    return posA - posB
  })

  return { products, listings }
}
