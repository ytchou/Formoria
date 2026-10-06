import type { CheerioAPI } from 'cheerio'

/**
 * Page classification and page text shared by the crawl and single-page
 * strategies. Lives here because `single-page.ts` cannot import `crawl.ts`:
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
