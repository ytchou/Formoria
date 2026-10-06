import type { CheerioAPI } from 'cheerio'

/**
 * Page classification and page text shared by the crawl, single-page and
 * platform-adapter strategies. Lives here because `single-page.ts` cannot import `crawl.ts`:
 * crawl already imports single-page.
 */

export type CandidateKind = 'about' | 'products' | 'contact' | 'stockist' | 'other'

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function classifyCandidate(urlString: string, text: string): CandidateKind {
  let path = ''
  try {
    path = new URL(urlString).pathname
  } catch {
    return 'other'
  }

  const haystack = safeDecode(`${path} ${text}`).toLowerCase()
  if (/(about|story|關於|品牌)/i.test(haystack)) return 'about'
  if (/(product|shop|商品)/i.test(haystack)) return 'products'
  if (/(contact|聯絡)/i.test(haystack)) return 'contact'
  if (/(where.to.buy|stores?|stockist|retailer|通路|銷售通路|購買通路|據點|門市|哪裡買)/i.test(haystack)) return 'stockist'
  return 'other'
}

// One whole path segment, optionally with a `.html` / `.htm` extension. English
// words are anchored on segment boundaries so `/store`, `/storefront`,
// `/restore-kit` and `/bookstore-collab` never match. zh-TW segments may join
// the vocabulary words (`門市據點`) but nothing else, so `/門市開幕` misses.
const STORE_LOCATOR_SEGMENT_RE =
  /^(?:where[-_]?to[-_]?buy|stores|store[-_]?locators?|stockists?|retailers?|(?:(?:銷售|購買)?通路|據點|門市|哪裡買)+)(?:\.html?)?$/i

/**
 * True when the URL itself is a store-locator page: one path segment is a
 * store-locator word (`/stores`, `/pages/store-locator`, `/about/stores`,
 * `/where-to-buy`, `/門市據點`). For a page we were handed directly.
 *
 * Stricter than `classifyCandidate`, which also reads link text and matches
 * substrings anywhere in the path; that looseness is fine for ranking crawl
 * links but misread `/store` and `/blogs/news/store-opening` as venue lists.
 */
export function isStoreLocatorPath(urlString: string): boolean {
  let path = ''
  try {
    path = new URL(urlString).pathname
  } catch {
    return false
  }
  return safeDecode(path)
    .split('/')
    .some((segment) => STORE_LOCATOR_SEGMENT_RE.test(segment))
}

/**
 * The page's visible text, whitespace-collapsed. Removes script, style,
 * noscript and template nodes from `$` in place, so call it on a document no
 * extractor still needs (JSON-LD lives in a script node).
 */
export function getPageText($: CheerioAPI): string | null {
  // Inline theme CSS and scripts are text nodes too; left in, they ate a third
  // of the 4 KB stockist cap (DEV-1941).
  $('script, style, noscript, template').remove()
  const text = ($('main').text() || $('body').text()).replace(/\s+/g, ' ').trim()
  return text || null
}
