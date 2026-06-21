export const SEARCH_DELAY_MS = 1500

const APIFY_SERP_ENDPOINT =
  'https://api.apify.com/v2/acts/scraperlink~google-search-results-serp-scraper/run-sync-get-dataset-items'
const SEARCH_TIMEOUT_MS = 60_000

type ApifySerpEntry = {
  error?: unknown
  results?: Array<{ url?: unknown }>
}

function isApifySerpEntry(value: unknown): value is ApifySerpEntry {
  return typeof value === 'object' && value !== null
}

function isGoogleUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return hostname.includes('google.com')
  } catch {
    return false
  }
}

export function parseApifySerpResults(data: unknown[]): string[] {
  const urls = new Set<string>()

  for (const entry of data) {
    if (!isApifySerpEntry(entry) || 'error' in entry || !Array.isArray(entry.results)) {
      continue
    }

    for (const result of entry.results) {
      if (typeof result.url !== 'string' || isGoogleUrl(result.url)) {
        continue
      }

      urls.add(result.url)
    }
  }

  return [...urls]
}

export async function searchBrandUrls(brandName: string): Promise<string[]> {
  const token = process.env.APIFY_TOKEN

  if (!token) {
    throw new Error('APIFY_TOKEN is not set')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)

  try {
    const res = await fetch(`${APIFY_SERP_ENDPOINT}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        keyword: `${brandName} 台灣`,
        limit: '10',
        country: 'TW',
        include_merged: false,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      return []
    }

    const data: unknown = await res.json()
    return Array.isArray(data) ? parseApifySerpResults(data) : []
  } catch (err) {
    console.error(`  → search failed: ${err instanceof Error ? err.message : err}`)
    return []
  } finally {
    clearTimeout(timeout)
  }
}

export async function searchBrandWebsite(brandName: string): Promise<string | null> {
  const urls = await searchBrandUrls(brandName)
  return urls[0] ?? null
}
