import { isNonBrandSiteHost } from './input-detector'
import type { ImageQueryInput, QueryTemplate } from './types'

export const SEARCH_DELAY_MS = 1500

export const DEFAULT_QUERY: QueryTemplate = (name: string) => `${name} 台灣`

/**
 * The brand's own hostname, `www.` stripped, or null when we hold no usable
 * URL. A malformed value is treated as "no website" rather than guessed at:
 * a wrong `site:` filter returns nothing at all, which is worse than a
 * name-only query.
 *
 * A platform host is rejected for the same reason, and this is the load-bearing
 * guard for it. 22 approved brands hold `threads.com` in `purchase_website`
 * today (plus two holding a link aggregator), and there is NO backfill planned
 * — those rows stay until a full pipeline re-run. `site:threads.com {name}`
 * searches the entire Threads platform rather than the brand, which is strictly
 * worse than the name query it would replace. Returning null here drops the
 * brand into the no-website branch and is what makes the missing backfill safe.
 */
function imageQueryHostname(website: string | null | undefined): string | null {
  const raw = website?.trim()
  if (!raw) return null
  if (isNonBrandSiteHost(raw)) return null
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
 * Without a domain (119 of 599 approved brands are Instagram-only): the name
 * query, keeping `商品`. On domain-anchored brands that keyword steers Google
 * onto marketplace listing pages, but here it is the only thing steering
 * towards commerce at all — dropping it pushes results onto Instagram lookaside
 * URLs that cost an ~800KB fetch each to resolve. The term that hurts one
 * segment is precisely the term that helps the other.
 *
 * NEITHER branch carries the product category. On the domain branch it was
 * destructive — with a quoted name it returned zero images for two of five
 * brands. On the open branch it was never justified: the A/B was inconclusive,
 * coverage of the field is patchy, and a wrong category actively poisons the
 * search. The category is now assigned downstream instead, where the site text
 * and the classified product photos are available to decide it — so it stopped
 * being an input to image acquisition and became an output of it.
 *
 * Either branch is one query, so one serper credit (billing is per request at
 * num<=10).
 */
export function buildImageQueryVariants(input: ImageQueryInput): string[] {
  const brandName = input.brandName.trim()
  if (!brandName) {
    return []
  }

  const hostname = imageQueryHostname(input.purchaseWebsite)
  if (hostname) {
    return [`site:${hostname} ${brandName}`]
  }

  return [`"${brandName}" 商品`]
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
