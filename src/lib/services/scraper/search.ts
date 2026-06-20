export const SEARCH_DELAY_MS = 1500

export const MARKETPLACE_DOMAINS = new Set([
  'pinkoi.com', 'shopee.tw', 'shopee.com.tw', 'momoshop.com.tw',
  'tw.buy.yahoo.com', 'buy.yahoo.com.tw', 'ruten.com.tw',
  'rakuten.com.tw', 'etsy.com', 'amazon.com', 'amazon.co.jp',
  'pcstore.com.tw', 'books.com.tw', 'eslite.com',
  'shopline.tw', 'easystore.co', 'meepshop.com',
  'storeberry.com', '91app.com',
])

export const SOCIAL_DOMAINS = new Set([
  'facebook.com', 'instagram.com', 'threads.net',
  'youtube.com', 'twitter.com', 'x.com', 'linkedin.com',
  'line.me', 'tiktok.com',
])

export const NOISE_DOMAINS = new Set([
  'wikipedia.org', 'google.com', 'google.com.tw',
  'duckduckgo.com', 'bing.com',
  '104.com.tw', '1111.com.tw',
  'gov.tw',
])

const ALL_BLOCKED_DOMAINS = new Set([
  ...MARKETPLACE_DOMAINS,
  ...SOCIAL_DOMAINS,
  ...NOISE_DOMAINS,
])

export function isOfficialUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    for (const d of ALL_BLOCKED_DOMAINS) {
      if (hostname === d || hostname.endsWith('.' + d)) return false
    }
    return true
  } catch {
    return false
  }
}

export async function searchBrandWebsite(brandName: string): Promise<string | null> {
  const query = encodeURIComponent(`${brandName} 台灣 官網`)
  const searchUrl = `https://html.duckduckgo.com/html/?q=${query}`

  try {
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    })
    if (!res.ok) return null

    const html = await res.text()
    const uddgRegex = /uddg=(https?%3A%2F%2F[^&"]+)/g
    let match
    while ((match = uddgRegex.exec(html)) !== null) {
      const decoded = decodeURIComponent(match[1])
      if (isOfficialUrl(decoded)) {
        return decoded
      }
    }
  } catch (err) {
    console.error(`  → search failed: ${err instanceof Error ? err.message : err}`)
  }

  return null
}
