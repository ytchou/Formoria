import { productTypeNameZh } from '@/lib/taxonomy/ontology'
import type { ImageQueryInput, QueryTemplate } from './types'

export const SEARCH_DELAY_MS = 1500

export const DEFAULT_QUERY: QueryTemplate = (name: string) => `${name} 台灣`

/**
 * The brand's own hostname, `www.` stripped, or null when we hold no usable
 * URL. A malformed value is treated as "no website" rather than guessed at:
 * a wrong `site:` filter returns nothing at all, which is worse than a
 * name-only query.
 */
function imageQueryHostname(website: string | null | undefined): string | null {
  const raw = website?.trim()
  if (!raw) return null
  try {
    const hostname = new URL(raw).hostname.toLowerCase().replace(/^www\./, '')
    return hostname || null
  } catch {
    return null
  }
}

/**
 * Labelling 231 serper candidates showed 53% rejected and 74% of those rejected
 * for *retrieval* (irrelevant / wrong brand), not for looking bad — the query,
 * not the filter, was the defect. Live probes on five brands then established
 * the two branches below.
 *
 * With a domain: `site:{host}` plus the brand name UNQUOTED. Stored names are
 * bilingual concatenations ("印花樂 inBlooom") and a brand's own site routinely
 * carries one half, or the other order, or a separator between them. Quoting
 * asks for adjacency and order, which is the one thing those names cannot
 * promise: degrading the name across twelve cases (english-only, chinese-only,
 * reversed) the unquoted form returned a full ten every time while the quoted
 * form thinned on a reversed bilingual name. Unquoted lets Google drop a term
 * that is not on the page, and its only downside — matching too loosely — is
 * already bounded by `site:` to the brand's own domain.
 *
 * Do NOT append the product category on top: with a quoted name it returned
 * zero images for two of five brands. Two constraints the page must satisfy is
 * the limit; three is over-specified.
 *
 * Without a domain (119 of 599 approved brands are Instagram-only): the name
 * query, keeping `商品`. On domain-anchored brands that keyword steers Google
 * onto marketplace listing pages, but here it is the only thing steering
 * towards commerce at all — dropping it pushes results onto Instagram lookaside
 * URLs that cost an ~800KB fetch each to resolve. The term that hurts one
 * segment is precisely the term that helps the other.
 *
 * Either branch is one query, so one serper credit (billing is per request at
 * num<=10).
 */
export function buildImageQueryVariants(input: ImageQueryInput): string[] {
  const brandName = input.brandName.trim()
  if (!brandName) {
    return []
  }

  // The image endpoint runs with hl=zh-TW, so the product type has to be the
  // Chinese category name — a raw English slug pulls in off-brand SERPs.
  const typeZh = productTypeNameZh(input.productType?.trim())
  const typeSegment = typeZh ? ` ${typeZh}` : ''

  const hostname = imageQueryHostname(input.purchaseWebsite)
  if (hostname) {
    return [`site:${hostname} ${brandName}`]
  }

  return [`"${brandName}"${typeSegment} 商品`]
}

export function stripTrackingParams(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.searchParams.delete('srsltid')
    return parsed.toString()
  } catch {
    return url
  }
}

export function isGoogleUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return hostname.includes('google.com')
  } catch {
    return false
  }
}

export {
  searchBrandUrls,
  batchSearchBrandsWithSnippets,
  batchSearchBrandImages,
  batchCaptureBrandImages,
  searchBrandMaps,
  parseBrandSearchEntries,
} from './serper'
export type {
  QueryTemplate,
  ImageQueryInput,
  BrandImageSearchOutcome,
  BrandImageSearchResult,
} from './types'
export type { SerperRawImageCandidate, SerperRawImageSearchOutcome } from './serper'
