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
 * With a domain: `site:{host}` returned 10/10 brand-owned images at a median
 * short edge of 2456px (vs 1000px for the old query), so it leads; the second
 * variant is the name query with `商品` dropped, because that keyword is what
 * steers Google onto marketplace listing pages. Two queries only make sense
 * here — the pair costs 2 serper credits (~$0.002/brand, since serper bills 1
 * credit per request at num<=10), and that spend is only justified when a
 * domain exists to anchor identity.
 *
 * Without a domain (119 of 599 approved brands are Instagram-only): keep the
 * single `商品` query. Dropping the keyword there pushes results onto Instagram
 * lookaside URLs that are expensive to resolve, so the term that hurts
 * domain-anchored brands is precisely the term that helps these.
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
    return [`site:${hostname}`, `"${brandName}"${typeSegment}`]
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
