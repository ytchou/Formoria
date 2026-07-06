export const SEARCH_DELAY_MS = 1500
type QueryTemplate = (brandName: string) => string

const DEFAULT_QUERY: QueryTemplate = (name: string) => `${name} 台灣`
const IMAGE_NEGATIVE_TERMS = ['-優惠', '-折扣', '-特價', '-coupon']

const APIFY_SERP_ENDPOINT =
  'https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items'
const APIFY_IMAGE_SEARCH_ENDPOINT =
  'https://api.apify.com/v2/acts/devisty~google-image-search-ppr/run-sync-get-dataset-items'
const SEARCH_TIMEOUT_MS = 60_000
const BATCH_SEARCH_TIMEOUT_MS = 240_000

type ApifySerpEntry = {
  searchQuery?: { term?: string; url?: string }
  organicResults?: Array<{ url?: string; title?: string; description?: string }>
  error?: string
}

type ApifyImageSearchResult = {
  originalImageUrl?: string
  thumbnailImageUrl?: string
  width?: number
  height?: number
  title?: string
  contextLink?: string
}

export type BrandImageSearchResult = {
  url: string
  query: string
}

type ImageQueryInput = {
  brandName: string
  productType?: string | null
  purchaseWebsite?: string | null
}

type ImageSearchBrandInput = string | ImageQueryInput

function extractSearchDomain(url: string | null | undefined): string | null {
  const value = url?.trim()
  if (!value) {
    return null
  }

  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    try {
      return new URL(`https://${value}`).hostname.replace(/^www\./, '')
    } catch {
      return null
    }
  }
}

export function buildImageQueryVariants(input: ImageQueryInput): string[] {
  const brandName = input.brandName.trim()
  if (!brandName) {
    return []
  }

  const productType = input.productType?.trim()
  const productSegment = productType ? `${productType} ` : ''
  const negatives = IMAGE_NEGATIVE_TERMS.join(' ')
  const variants = [
    `"${brandName}" ${productSegment}商品 ${negatives}`,
  ]
  const domain = extractSearchDomain(input.purchaseWebsite)
  if (domain) {
    variants.push(`site:${domain} "${brandName}" ${productSegment}商品 ${negatives}`)
  }
  variants.push(`"${brandName}" 台灣 ${negatives}`)

  return [...new Set(variants)].slice(0, 3)
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
    if (!isApifySerpEntry(entry) || 'error' in entry || !Array.isArray(entry.organicResults)) {
      continue
    }

    for (const result of entry.organicResults) {
      if (typeof result.url !== 'string' || isGoogleUrl(result.url)) {
        continue
      }

      urls.add(stripTrackingParams(result.url))
    }
  }

  return [...urls]
}

function parseApifySerpSnippets(data: unknown[]): string[] {
  const snippets: string[] = []
  for (const entry of data) {
    if (!isApifySerpEntry(entry) || 'error' in entry || !Array.isArray(entry.organicResults)) {
      continue
    }
    for (const result of entry.organicResults) {
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

async function fetchSerpData(
  brandName: string,
  queryTemplate: QueryTemplate = DEFAULT_QUERY
): Promise<unknown[]> {
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
        queries: queryTemplate(brandName),
        maxPagesPerQuery: 1,
        countryCode: 'tw',
        languageCode: 'zh-TW',
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

export async function searchBrandUrls(
  brandName: string,
  queryTemplate: QueryTemplate = DEFAULT_QUERY
): Promise<string[]> {
  const data = await fetchSerpData(brandName, queryTemplate)
  return parseApifySerpResults(data)
}

export async function searchBrandWithSnippets(
  brandName: string,
  queryTemplate: QueryTemplate = DEFAULT_QUERY
): Promise<{ urls: string[], snippets: string[] }> {
  const data = await fetchSerpData(brandName, queryTemplate)
  return {
    urls: parseApifySerpResults(data),
    snippets: parseApifySerpSnippets(data),
  }
}

type BrandSearchResult = { urls: string[], snippets: string[], rawEntries?: unknown[] }

export async function batchSearchBrandsWithSnippets(
  brandNames: string[],
  queryTemplate: QueryTemplate = DEFAULT_QUERY
): Promise<Map<string, BrandSearchResult>> {
  const names = brandNames.slice(0, 20)
  const results = new Map<string, BrandSearchResult>()

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
    queryToBrand.set(queryTemplate(brandName), brandName)
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
        queries: names.map((brandName) => queryTemplate(brandName)).join('\n'),
        maxPagesPerQuery: 1,
        countryCode: 'tw',
        languageCode: 'zh-TW',
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      return results
    }

    const data: unknown = await res.json()
    const entries = Array.isArray(data) ? data : []

    const errorEntries = entries.filter(e => isApifySerpEntry(e) && typeof e.error === 'string')
    if (errorEntries.length > 0) {
      const firstError = isApifySerpEntry(errorEntries[0]) ? errorEntries[0].error : undefined
      console.error(`  [SERP] ${errorEntries.length}/${entries.length} entries have errors: ${firstError}`)
    }

    const grouped = new Map<string, unknown[]>()

    for (const entry of entries) {
      if (!isApifySerpEntry(entry)) {
        continue
      }

      const query = typeof entry.searchQuery?.term === 'string'
        ? entry.searchQuery.term.trim()
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
        rawEntries: group,
      })
    }

    const emptyBrands = names.filter(n => {
      const r = results.get(n)
      return !r || (r.urls.length === 0 && r.snippets.length === 0)
    })
    if (emptyBrands.length > 0) {
      console.log(`  [SERP] ${emptyBrands.length} brand(s) with no results: ${emptyBrands.join(', ')}`)
    }

    return results
  } catch (err) {
    console.error(`  → batch search failed: ${err instanceof Error ? err.message : err}`)
    return results
  } finally {
    clearTimeout(timeout)
  }
}

async function searchBrandImagesForQuery(query: string): Promise<BrandImageSearchResult[]> {
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
        q: query,
        num: 5,
        page: 1,
        gl: 'tw',
        hl: 'zh-TW',
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
      .map((url) => ({ url, query }))
  } catch (err) {
    console.error(`  → image search failed: ${err instanceof Error ? err.message : err}`)
    return []
  } finally {
    clearTimeout(timeout)
  }
}

async function searchBrandImages(
  input: ImageSearchBrandInput,
  queryTemplate: QueryTemplate = DEFAULT_QUERY
): Promise<BrandImageSearchResult[]> {
  const brandName = typeof input === 'string' ? input : input.brandName
  const queries = typeof input === 'string'
    ? [queryTemplate(brandName)]
    : buildImageQueryVariants(input)
  const results = new Map<string, BrandImageSearchResult>()

  for (const query of queries) {
    const rows = await searchBrandImagesForQuery(query)
    for (const row of rows) {
      if (!results.has(row.url)) {
        results.set(row.url, row)
      }
    }
  }

  return [...results.values()]
}

export async function batchSearchBrandImages(
  brandInputs: ImageSearchBrandInput[],
  concurrency: number = 5,
  queryTemplate: QueryTemplate = DEFAULT_QUERY
): Promise<Map<string, BrandImageSearchResult[]>> {
  const results = new Map<string, BrandImageSearchResult[]>()
  const workerCount = Math.max(1, Math.min(concurrency, brandInputs.length))
  let nextIndex = 0

  for (const input of brandInputs) {
    const brandName = typeof input === 'string' ? input : input.brandName
    results.set(brandName, [])
  }

  async function worker(): Promise<void> {
    while (nextIndex < brandInputs.length) {
      const index = nextIndex
      nextIndex += 1
      const input = brandInputs[index]
      const brandName = typeof input === 'string' ? input : input.brandName

      try {
        results.set(brandName, await searchBrandImages(input, queryTemplate))
      } catch (err) {
        console.error(`  → image search failed: ${err instanceof Error ? err.message : err}`)
        results.set(brandName, [])
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}
