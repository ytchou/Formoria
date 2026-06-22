export const SEARCH_DELAY_MS = 1500

const APIFY_SERP_ENDPOINT =
  'https://api.apify.com/v2/acts/scraperlink~google-search-results-serp-scraper/run-sync-get-dataset-items'
const APIFY_IMAGE_SEARCH_ENDPOINT =
  'https://api.apify.com/v2/acts/devisty~google-image-search-ppr/run-sync-get-dataset-items'
const SEARCH_TIMEOUT_MS = 60_000
const BATCH_SEARCH_TIMEOUT_MS = 240_000

type ApifySerpEntry = {
  error?: unknown
  search_term?: unknown
  keyword?: unknown
  results?: Array<{ url?: unknown; title?: unknown; description?: unknown }>
}

type ApifyImageSearchResult = {
  originalImageUrl?: string
  thumbnailImageUrl?: string
  width?: number
  height?: number
  title?: string
  contextLink?: string
}

function isApifySerpEntry(value: unknown): value is ApifySerpEntry {
  return typeof value === 'object' && value !== null
}

function stripTrackingParams(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.searchParams.delete('srsltid')
    return parsed.toString()
  } catch {
    return url
  }
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

      urls.add(stripTrackingParams(result.url))
    }
  }

  return [...urls]
}

export function parseApifySerpSnippets(data: unknown[]): string[] {
  const snippets: string[] = []
  for (const entry of data) {
    if (!isApifySerpEntry(entry) || 'error' in entry || !Array.isArray(entry.results)) {
      continue
    }
    for (const result of entry.results) {
      const parts: string[] = []
      if (typeof result.title === 'string' && result.title.trim()) {
        parts.push(result.title.trim())
      }
      if (typeof result.description === 'string' && result.description.trim()) {
        parts.push(result.description.trim())
      }
      if (parts.length > 0) {
        snippets.push(parts.join(' — '))
      }
    }
  }
  return snippets
}

async function fetchSerpData(brandName: string): Promise<unknown[]> {
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
    return Array.isArray(data) ? data : []
  } catch (err) {
    console.error(`  → search failed: ${err instanceof Error ? err.message : err}`)
    return []
  } finally {
    clearTimeout(timeout)
  }
}

export async function searchBrandUrls(brandName: string): Promise<string[]> {
  const data = await fetchSerpData(brandName)
  return parseApifySerpResults(data)
}

export async function searchBrandWithSnippets(brandName: string): Promise<{ urls: string[], snippets: string[] }> {
  const data = await fetchSerpData(brandName)
  return {
    urls: parseApifySerpResults(data),
    snippets: parseApifySerpSnippets(data),
  }
}

export async function batchSearchBrandsWithSnippets(
  brandNames: string[]
): Promise<Map<string, { urls: string[], snippets: string[] }>> {
  const names = brandNames.slice(0, 20)
  const results = new Map<string, { urls: string[], snippets: string[] }>()

  for (const brandName of names) {
    results.set(brandName, { urls: [], snippets: [] })
  }

  if (names.length === 0) {
    return results
  }

  const token = process.env.APIFY_TOKEN

  if (!token) {
    throw new Error('APIFY_TOKEN is not set')
  }

  const queryToBrand = new Map<string, string>()
  for (const brandName of names) {
    queryToBrand.set(`${brandName} 台灣`, brandName)
    queryToBrand.set(brandName, brandName)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), BATCH_SEARCH_TIMEOUT_MS)

  try {
    const res = await fetch(`${APIFY_SERP_ENDPOINT}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        keyword: names.map((brandName) => `${brandName} 台灣`).join('\n'),
        limit: '10',
        country: 'TW',
        include_merged: false,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      return results
    }

    const data: unknown = await res.json()
    const entries = Array.isArray(data) ? data : []
    const grouped = new Map<string, unknown[]>()

    for (const entry of entries) {
      if (!isApifySerpEntry(entry)) {
        continue
      }

      const query = typeof entry.search_term === 'string'
        ? entry.search_term.trim()
        : typeof entry.keyword === 'string'
          ? entry.keyword.trim()
          : ''
      const brandName = queryToBrand.get(query)

      if (!brandName) {
        continue
      }

      const group = grouped.get(brandName) ?? []
      group.push(entry)
      grouped.set(brandName, group)
    }

    for (const [brandName, group] of grouped.entries()) {
      results.set(brandName, {
        urls: parseApifySerpResults(group),
        snippets: parseApifySerpSnippets(group),
      })
    }

    return results
  } catch (err) {
    console.error(`  → batch search failed: ${err instanceof Error ? err.message : err}`)
    return results
  } finally {
    clearTimeout(timeout)
  }
}

export async function searchBrandWebsite(brandName: string): Promise<string | null> {
  const urls = await searchBrandUrls(brandName)
  return urls[0] ?? null
}

export async function searchBrandImages(brandName: string): Promise<string[]> {
  const token = process.env.APIFY_TOKEN

  if (!token) {
    throw new Error('APIFY_TOKEN is not set')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)

  try {
    const res = await fetch(`${APIFY_IMAGE_SEARCH_ENDPOINT}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: `${brandName} 台灣`,
        num: 5,
        page: 1,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      return []
    }

    const data: unknown = await res.json()
    if (!Array.isArray(data)) return []

    const MIN_DIMENSION = 400

    return data
      .filter((item): item is ApifyImageSearchResult =>
        typeof item === 'object' && item !== null && typeof (item as ApifyImageSearchResult).originalImageUrl === 'string'
      )
      .filter((item) => {
        const w = item.width ?? 0
        const h = item.height ?? 0
        return w === 0 || h === 0 || w >= MIN_DIMENSION || h >= MIN_DIMENSION
      })
      .map((item) => item.originalImageUrl!)
      .filter(Boolean)
  } catch (err) {
    console.error(`  → image search failed: ${err instanceof Error ? err.message : err}`)
    return []
  } finally {
    clearTimeout(timeout)
  }
}

export async function batchSearchBrandImages(
  brandNames: string[],
  concurrency: number = 5
): Promise<Map<string, string[]>> {
  const results = new Map<string, string[]>()
  const workerCount = Math.max(1, Math.min(concurrency, brandNames.length))
  let nextIndex = 0

  for (const brandName of brandNames) {
    results.set(brandName, [])
  }

  async function worker(): Promise<void> {
    while (nextIndex < brandNames.length) {
      const index = nextIndex
      nextIndex += 1
      const brandName = brandNames[index]

      try {
        results.set(brandName, await searchBrandImages(brandName))
      } catch (err) {
        console.error(`  → image search failed: ${err instanceof Error ? err.message : err}`)
        results.set(brandName, [])
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}
