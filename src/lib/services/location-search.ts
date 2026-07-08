import { getSiteUrl } from '@/lib/site-url'

export type LocationSearchResult = {
  id: string
  name: string
  address: string
  latitude: number
  longitude: number
}

type NominatimResult = {
  place_id?: number
  osm_type?: string
  osm_id?: number
  lat?: string
  lon?: string
  display_name?: string
  namedetails?: {
    name?: string
    'name:zh'?: string
    'name:zh-TW'?: string
    brand?: string
  }
}

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search'
const MIN_QUERY_LENGTH = 3
const MAX_RESULTS = 5
const REQUEST_INTERVAL_MS = 1000

const cache = new Map<string, LocationSearchResult[]>()
let nextRequestAt = 0

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function cacheKey(query: string, locale: string) {
  return `${locale}:${query.trim().toLocaleLowerCase()}`
}

function getDisplayName(result: NominatimResult) {
  return (
    result.namedetails?.['name:zh-TW']?.trim() ||
    result.namedetails?.['name:zh']?.trim() ||
    result.namedetails?.name?.trim() ||
    result.namedetails?.brand?.trim() ||
    result.display_name?.split(',').at(0)?.trim() ||
    ''
  )
}

function normalizeResult(result: NominatimResult): LocationSearchResult | null {
  const latitude = Number.parseFloat(result.lat ?? '')
  const longitude = Number.parseFloat(result.lon ?? '')
  const address = result.display_name?.trim() ?? ''
  const name = getDisplayName(result)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !address) {
    return null
  }

  return {
    id:
      result.osm_type && result.osm_id
        ? `${result.osm_type}-${result.osm_id}`
        : String(result.place_id ?? address),
    name: name || address,
    address,
    latitude,
    longitude,
  }
}

function getNominatimUserAgent() {
  return `Formoria/0.1 (${getSiteUrl()}; contact: ops@formoria.com)`
}

export async function searchLocations(
  query: string,
  locale = 'zh-TW',
): Promise<LocationSearchResult[]> {
  const normalizedQuery = query.trim()
  if (normalizedQuery.length < MIN_QUERY_LENGTH) return []

  const key = cacheKey(normalizedQuery, locale)
  const cached = cache.get(key)
  if (cached) return cached

  let now = Date.now()
  if (now < nextRequestAt) {
    await delay(nextRequestAt - now)
    now = Date.now()
  }
  nextRequestAt = now + REQUEST_INTERVAL_MS

  const params = new URLSearchParams({
    q: normalizedQuery,
    format: 'jsonv2',
    addressdetails: '1',
    namedetails: '1',
    countrycodes: 'tw',
    limit: String(MAX_RESULTS),
  })

  const response = await fetch(`${NOMINATIM_SEARCH_URL}?${params.toString()}`, {
    headers: {
      'Accept-Language': locale,
      'User-Agent': getNominatimUserAgent(),
    },
  })

  if (!response.ok) {
    throw new Error(`Location search failed with status ${response.status}`)
  }

  const data: unknown = await response.json()
  if (!Array.isArray(data)) return []

  const results = data.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const result = normalizeResult(item as NominatimResult)
    return result ? [result] : []
  })
  cache.set(key, results)
  return results
}
