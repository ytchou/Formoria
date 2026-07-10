import type {
  BrandImageSearchResult,
  BrandSearchResult,
  ImageSearchBrandInput,
  QueryTemplate,
} from './types'
import { DEFAULT_QUERY, buildImageQueryVariants, isGoogleUrl, stripTrackingParams } from './search'

const SERPER_SERP_ENDPOINT = 'https://google.serper.dev/search'
const SERPER_IMAGE_ENDPOINT = 'https://google.serper.dev/images'
const SEARCH_TIMEOUT_MS = 60_000
const MIN_IMAGE_DIMENSION = 400

type SerperSerpResponse = {
  organic: Array<{
    title: string
    link: string
    snippet?: string
    position: number
  }>
}

type SerperImageResponse = {
  images: Array<{
    imageUrl: string
    imageWidth?: number
    imageHeight?: number
    title?: string
  }>
}

function isSerperSerpResponse(value: unknown): value is SerperSerpResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'organic' in value &&
    Array.isArray((value as SerperSerpResponse).organic)
  )
}

function isSerperImageResponse(value: unknown): value is SerperImageResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'images' in value &&
    Array.isArray((value as SerperImageResponse).images)
  )
}



type SerpApiResult = {
  organic: SerperSerpResponse['organic']
  fullResponse: unknown
  latencyMs: number
}

async function callSerpApi(brandName: string, queryTemplate: QueryTemplate): Promise<SerpApiResult> {
  const apiKey = process.env.SERPER_API_KEY

  if (!apiKey) {
    throw new Error('SERPER_API_KEY is not set')
  }

  const query = queryTemplate ? queryTemplate(brandName) : DEFAULT_QUERY(brandName)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)
  const startAt = Date.now()

  try {
    const res = await fetch(SERPER_SERP_ENDPOINT, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: query,
        num: 10,
        gl: 'tw',
        hl: 'zh-TW',
      }),
      signal: controller.signal,
    })

    const latencyMs = Date.now() - startAt

    if (!res.ok) {
      return { organic: [], fullResponse: null, latencyMs }
    }

    const data: unknown = await res.json()
    const organic = isSerperSerpResponse(data) ? data.organic : []
    return { organic, fullResponse: data, latencyMs }
  } finally {
    clearTimeout(timeout)
  }
}

export async function searchBrandUrls(
  brandName: string,
  queryTemplate: QueryTemplate = DEFAULT_QUERY
): Promise<string[]> {
  try {
    const { organic: entries } = await callSerpApi(brandName, queryTemplate)

    const urls = new Set<string>()
    for (const result of entries) {
      const link = typeof result.link === 'string' ? result.link.trim() : ''
      if (!link) {
        continue
      }
      const stripped = stripTrackingParams(link)
      if (isGoogleUrl(stripped)) {
        continue
      }
      urls.add(stripped)
    }

    return [...urls]
  } catch (err) {
    console.error(`  → search failed: ${err instanceof Error ? err.message : err}`)
    if (err instanceof Error && err.message.includes('SERPER_API_KEY')) {
      throw err
    }
    return []
  }
}

function parseBrandSearchResults(organic: SerperSerpResponse['organic']): Pick<BrandSearchResult, 'urls' | 'snippets'> {
  const urls = new Set<string>()
  const snippets: string[] = []

  for (const result of organic) {
    const link = typeof result.link === 'string' ? result.link.trim() : ''
    if (!link) {
      continue
    }

    const stripped = stripTrackingParams(link)
    if (isGoogleUrl(stripped)) {
      continue
    }

    if (!urls.has(stripped)) {
      urls.add(stripped)
      const title = result.title?.trim() || ''
      const snippet = result.snippet?.trim() || ''
      snippets.push(title && snippet ? `${title} — ${snippet}` : title)
    }
  }

  return {
    urls: [...urls],
    snippets,
  }
}

export async function batchSearchBrandsWithSnippets(
  brandNames: string[],
  queryTemplate: QueryTemplate = DEFAULT_QUERY,
  concurrency: number = 5
): Promise<Map<string, BrandSearchResult>> {
  const names = brandNames.slice(0, 20)
  const results = new Map<string, BrandSearchResult>()

  for (const brandName of names) {
    results.set(brandName, { urls: [], snippets: [] })
  }

  if (names.length === 0) {
    return results
  }

  const workerCount = Math.max(1, Math.min(concurrency, names.length))
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < names.length) {
      const index = nextIndex
      nextIndex += 1

      const brandName = names[index]
      try {
        const { organic, fullResponse, latencyMs } = await callSerpApi(brandName, queryTemplate)
        const parsed = parseBrandSearchResults(organic)
        results.set(brandName, {
          ...parsed,
          rawEntries: fullResponse,
          latencyMs,
        })
      } catch (err) {
        if (err instanceof Error && err.message.includes('SERPER_API_KEY')) {
          throw err
        }
        console.error(`  → search failed: ${err instanceof Error ? err.message : err}`)
        results.set(brandName, { urls: [], snippets: [] })
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  const emptyBrands = names.filter((n) => {
    const result = results.get(n)
    return !result || (result.urls.length === 0 && result.snippets.length === 0)
  })

  if (emptyBrands.length > 0) {
    console.log(`  [SERP] ${emptyBrands.length} brand(s) with no results: ${emptyBrands.join(', ')}`)
  }

  return results
}

const IMAGE_BLOCKED_HOSTS = [
  'lookaside.instagram.com',
  'lookaside.fbsbx.com',
]

function shouldKeepImage(result: SerperImageResponse['images'][number]): boolean {
  try {
    const host = new URL(result.imageUrl).hostname
    if (IMAGE_BLOCKED_HOSTS.some((blocked) => host.includes(blocked))) return false
  } catch { /* keep if URL parsing fails */ }

  const width = result.imageWidth ?? 0
  const height = result.imageHeight ?? 0

  return width === 0 || height === 0 || width >= MIN_IMAGE_DIMENSION || height >= MIN_IMAGE_DIMENSION
}

async function searchBrandImagesForQuery(query: string): Promise<BrandImageSearchResult[]> {
  const apiKey = process.env.SERPER_API_KEY

  if (!apiKey) {
    throw new Error('SERPER_API_KEY is not set')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)

  try {
    const res = await fetch(SERPER_IMAGE_ENDPOINT, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, num: 10, gl: 'tw', hl: 'zh-TW' }),
      signal: controller.signal,
    })

    if (!res.ok) {
      return []
    }

    const data: unknown = await res.json()
    if (!isSerperImageResponse(data)) {
      return []
    }

    const results = new Map<string, BrandImageSearchResult>()
    for (const result of data.images) {
      if (!result.imageUrl || typeof result.imageUrl !== 'string') {
        continue
      }
      if (!shouldKeepImage(result)) {
        continue
      }
      if (!results.has(result.imageUrl)) {
        results.set(result.imageUrl, {
          url: result.imageUrl,
          query,
        })
      }
    }

    return [...results.values()]
  } catch (err) {
    console.error(`  → image search failed: ${err instanceof Error ? err.message : err}`)
    if (err instanceof Error && err.message.includes('SERPER_API_KEY')) {
      throw err
    }
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
        if (err instanceof Error && err.message.includes('SERPER_API_KEY')) {
          throw err
        }
        console.error(`  → image search failed: ${err instanceof Error ? err.message : err}`)
        results.set(brandName, [])
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}
