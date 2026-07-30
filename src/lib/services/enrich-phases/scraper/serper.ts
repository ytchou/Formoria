import {
  finishSearchAudit,
  startSearchAudit,
  type SearchAuditContext,
  type SearchCallStatus,
} from '@/lib/services/search-results'
import type {
  BrandImageSearchOutcome,
  BrandImageSearchResult,
  BrandSearchEntry,
  BrandSearchResult,
  ImageSearchBrandInput,
  QueryTemplate,
} from './types'
import { DEFAULT_QUERY, buildImageQueryVariants, isGoogleUrl, stripTrackingParams } from './search'
import { fetchHtml } from './fetch-guards'

const SERPER_SERP_ENDPOINT = 'https://google.serper.dev/search'
const SERPER_IMAGE_ENDPOINT = 'https://google.serper.dev/images'
const SERPER_MAPS_ENDPOINT = 'https://google.serper.dev/maps'
const SEARCH_TIMEOUT_MS = 60_000
const MIN_IMAGE_DIMENSION = 400
const MAX_ERROR_LENGTH = 1_000

export type SerperAuditOptions = SearchAuditContext & {
  config?: unknown
  dryRun?: boolean
  attempt?: number
}

type AuditResolver<T> = SerperAuditOptions | ((input: T) => SerperAuditOptions | undefined)

// serper.dev omits the result-array key entirely when a search has zero results,
// so these members are optional: absent means "empty", not "malformed".
type SerperSerpResponse = {
  organic?: Array<{
    title: string
    link: string
    snippet?: string
    position: number
  }>
}

type SerperImageResponse = {
  images?: Array<{
    imageUrl: string
    imageWidth?: number
    imageHeight?: number
    title?: string
  }>
}

export type SerperMapPlace = {
  title: string
  address?: string
  latitude?: number
  longitude?: number
  website?: string
  link?: string
  category?: string
  phoneNumber?: string
}

type SerperMapsResponse = {
  places?: Array<Record<string, unknown>>
}

type SerperCallResult<T> = {
  data: T | null
  fullResponse: unknown
  latencyMs: number
  callStatus: SearchCallStatus
  httpStatus: number | null
  error: string | null
  auditResultId?: string
}

export type BrandMapsSearchResult = {
  places: SerperMapPlace[]
  rawResponse: unknown
  latencyMs: number
  callStatus: SearchCallStatus
  httpStatus: number | null
  error: string | null
  auditResultId?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// A missing key is a legitimately empty result set; a present-but-wrong-shaped
// key is still malformed.
function isOptionalArrayOf(value: unknown, entryPredicate: (entry: unknown) => boolean): boolean {
  if (value === undefined) return true
  return Array.isArray(value) && value.every(entryPredicate)
}

function isSerperSerpResponse(value: unknown): value is SerperSerpResponse {
  return (
    isRecord(value) &&
    isOptionalArrayOf(value.organic, (entry) => isRecord(entry) && typeof entry.link === 'string')
  )
}

function isSerperImageResponse(value: unknown): value is SerperImageResponse {
  return (
    isRecord(value) &&
    isOptionalArrayOf(value.images, (entry) => isRecord(entry) && typeof entry.imageUrl === 'string')
  )
}

function isSerperMapsResponse(value: unknown): value is SerperMapsResponse {
  return (
    isRecord(value) &&
    isOptionalArrayOf(value.places, (entry) => isRecord(entry) && typeof entry.title === 'string')
  )
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, MAX_ERROR_LENGTH)
}

function bodyForAudit(body: Record<string, unknown>): Record<string, unknown> {
  return body
}

type FinishResult = {
  callStatus: SearchCallStatus
  httpStatus?: number | null
  error?: string | null
  fullResponse?: unknown
  data?: unknown
  urls?: string[]
  snippets?: string[]
}

async function callSerperJson<T>(
  endpoint: string,
  searchType: 'serp' | 'image' | 'maps',
  query: string,
  body: Record<string, unknown>,
  isValidResponse: (value: unknown) => value is T,
  normalizeResponse: (value: T) => { urls: string[]; snippets: string[] },
  options?: SerperAuditOptions,
): Promise<SerperCallResult<T>> {
  const requestBody = bodyForAudit(body)
  const auditResultId = options
    ? await startSearchAudit({
        ...options,
        provider: 'serper',
        endpoint,
        searchType,
        query,
        input: requestBody,
        config: {
          ...(isRecord(options.config) ? options.config : {}),
          ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
        },
        attempt: options.attempt,
      })
    : undefined

  const apiKey = process.env.SERPER_API_KEY
  if (!apiKey) {
    const missingKey = 'SERPER_API_KEY is not set'
    if (auditResultId) {
      await finishSearchAudit(
        auditResultId,
        {
          callStatus: 'failed',
          error: missingKey,
          latencyMs: 0,
        },
        options?.supabase,
      )
    }
    throw new Error(missingKey)
  }

  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, SEARCH_TIMEOUT_MS)
  const startAt = Date.now()

  const finalize = async (result: FinishResult): Promise<SerperCallResult<T>> => {
    const latencyMs = Date.now() - startAt
    if (auditResultId) {
      await finishSearchAudit(
        auditResultId,
        {
          callStatus: result.callStatus,
          httpStatus: result.httpStatus,
          error: result.error,
          rawResponse: result.fullResponse,
          urls: result.urls,
          snippets: result.snippets,
          latencyMs,
        },
        options?.supabase,
      )
    }
    return {
      data: (result.data as T | null | undefined) ?? null,
      fullResponse: result.fullResponse ?? null,
      latencyMs,
      callStatus: result.callStatus,
      httpStatus: result.httpStatus ?? null,
      error: result.error ?? null,
      ...(auditResultId ? { auditResultId } : {}),
    }
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!response.ok) {
      let responseBody: unknown = null
      try {
        responseBody = await response.json()
      } catch {
        responseBody = null
      }
      return await finalize({
        callStatus: 'failed',
        httpStatus: response.status,
        error: `Serper HTTP ${response.status}`,
        fullResponse: responseBody,
      })
    }

    let responseBody: unknown
    try {
      responseBody = await response.json()
    } catch (error) {
      return await finalize({
        callStatus: 'malformed',
        httpStatus: response.status,
        error: `Malformed JSON: ${errorText(error)}`,
      })
    }

    if (!isValidResponse(responseBody)) {
      return await finalize({
        callStatus: 'malformed',
        httpStatus: response.status,
        error: 'Serper response shape was not recognized',
        fullResponse: responseBody,
      })
    }

    const resultCount =
      searchType === 'serp'
        ? ((responseBody as SerperSerpResponse).organic?.length ?? 0)
        : searchType === 'image'
          ? ((responseBody as SerperImageResponse).images?.length ?? 0)
          : ((responseBody as SerperMapsResponse).places?.length ?? 0)
    const normalized = normalizeResponse(responseBody)
    return await finalize({
      data: responseBody,
      fullResponse: responseBody,
      callStatus: resultCount === 0 ? 'empty' : 'succeeded',
      httpStatus: response.status,
      urls: normalized.urls,
      snippets: normalized.snippets,
    })
  } catch (error) {
    const callStatus: SearchCallStatus =
      timedOut || (error instanceof Error && error.name === 'AbortError') ? 'timeout' : 'network_error'
    return await finalize({
      callStatus,
      error: errorText(error),
    })
  } finally {
    clearTimeout(timeout)
  }
}

function parseBrandSearchResults(
  organic: SerperSerpResponse['organic'],
): Pick<BrandSearchResult, 'urls' | 'snippets' | 'entries'> {
  const urls = new Set<string>()
  const snippets: string[] = []
  const entries: BrandSearchEntry[] = []

  for (const result of organic ?? []) {
    const link = typeof result.link === 'string' ? result.link.trim() : ''
    if (!link) continue

    const stripped = stripTrackingParams(link)
    if (isGoogleUrl(stripped)) continue

    const title = typeof result.title === 'string' ? result.title.trim() : ''
    const snippet = typeof result.snippet === 'string' ? result.snippet.trim() : ''
    entries.push({
      title,
      link: stripped,
      ...(snippet ? { snippet } : {}),
      ...(typeof result.position === 'number' ? { position: result.position } : {}),
    })
    if (!urls.has(stripped)) {
      urls.add(stripped)
      snippets.push(title && snippet ? `${title} — ${snippet}` : title || snippet)
    }
  }

  return { urls: [...urls], snippets, entries }
}

export function parseBrandSearchEntries(rawResponse: unknown): BrandSearchEntry[] {
  if (!isSerperSerpResponse(rawResponse)) return []
  return parseBrandSearchResults(rawResponse.organic).entries ?? []
}

function resolveAuditOptions<T>(resolver: AuditResolver<T> | undefined, input: T): SerperAuditOptions | undefined {
  return typeof resolver === 'function' ? resolver(input) : resolver
}

export async function searchBrandUrls(
  brandName: string,
  queryTemplate: QueryTemplate = DEFAULT_QUERY,
  auditOptions?: SerperAuditOptions,
): Promise<string[]> {
  const query = queryTemplate ? queryTemplate(brandName) : DEFAULT_QUERY(brandName)
  const result = await callSerperJson(
    SERPER_SERP_ENDPOINT,
    'serp',
    query,
    { q: query, num: 10, gl: 'tw', hl: 'zh-TW' },
    isSerperSerpResponse,
    (value) => parseBrandSearchResults(value.organic),
    auditOptions,
  )
  if (!result.data) return []
  return parseBrandSearchResults(result.data.organic).urls
}

export async function batchSearchBrandsWithSnippets(
  brandNames: string[],
  queryTemplate: QueryTemplate = DEFAULT_QUERY,
  concurrency = 5,
  auditResolver?: AuditResolver<string>,
): Promise<Map<string, BrandSearchResult>> {
  const names = brandNames.slice(0, 20)
  const results = new Map<string, BrandSearchResult>()
  for (const brandName of names) results.set(brandName, { urls: [], snippets: [] })
  if (names.length === 0) return results

  const workerCount = Math.max(1, Math.min(concurrency, names.length))
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < names.length) {
      const index = nextIndex
      nextIndex += 1
      const brandName = names[index]
      const query = queryTemplate ? queryTemplate(brandName) : DEFAULT_QUERY(brandName)
      const options = resolveAuditOptions(auditResolver, brandName)
      const result = await callSerperJson(
        SERPER_SERP_ENDPOINT,
        'serp',
        query,
        { q: query, num: 10, gl: 'tw', hl: 'zh-TW' },
        isSerperSerpResponse,
        (value) => parseBrandSearchResults(value.organic),
        options,
      )
      const parsed = result.data
        ? parseBrandSearchResults(result.data.organic)
        : { urls: [], snippets: [], entries: [] }
      results.set(brandName, {
        ...parsed,
        rawEntries: result.fullResponse,
        latencyMs: result.latencyMs,
        auditResultId: result.auditResultId,
        callStatus: result.callStatus,
        httpStatus: result.httpStatus,
        error: result.error,
      })
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

// Meta serves an HTML crawler page at these hosts, never image bytes, so a URL
// here is unusable until it is resolved to the photo the page embeds.
const IMAGE_BLOCKED_HOSTS = ['lookaside.instagram.com', 'lookaside.fbsbx.com']

// Each resolution costs an ~800KB HTML fetch and publishability only needs a
// couple of usable images, so cap how many we spend per brand.
const MAX_LOOKASIDE_RESOLUTIONS_PER_BRAND = 3

const OG_IMAGE_PATTERN = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
const SCONTENT_JPG_PATTERN = /https:\/\/scontent[^"'\\ )]+\.jpg[^"'\\ )]*/gi
const INSTAGRAM_MEDIA_FILE_PATTERN = /\/(\d+_\d+_\d+_n\.jpg)/
// A leading `c123.` crop directive or an `_s640x640` cap both shrink the render.
const CROPPED_STP_PATTERN = /(^|_)c\d/
const CAPPED_STP_PATTERN = /_s\d+x\d+/

type LookasideBudget = { remaining: number }

function isLookasideHost(imageUrl: string): boolean {
  try {
    const host = new URL(imageUrl).hostname
    return IMAGE_BLOCKED_HOSTS.some((blocked) => host.includes(blocked))
  } catch {
    // Keep malformed URLs for the existing downstream validator to reject.
    return false
  }
}

function passesImageDimensions(result: NonNullable<SerperImageResponse['images']>[number]): boolean {
  const width = result.imageWidth ?? 0
  const height = result.imageHeight ?? 0
  return width === 0 || height === 0 || width >= MIN_IMAGE_DIMENSION || height >= MIN_IMAGE_DIMENSION
}

function shouldKeepImage(result: NonNullable<SerperImageResponse['images']>[number]): boolean {
  if (isLookasideHost(result.imageUrl)) return false
  return passesImageDimensions(result)
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, '/')
    .replace(/&#39;/g, "'")
}

/**
 * Turns a lookaside crawler URL into a real photo URL.
 *
 * The page embeds the same media file twice: `og:image` is a cropped ~480px
 * render, and an uncropped/uncapped variant of the same file sits alongside it
 * at roughly 800px. Both carry their own signature, which is why selecting the
 * uncropped URL works where rewriting og:image's own `stp` parameter returns
 * 403. Falls back to og:image when no better variant is present, and returns
 * null when the page cannot be fetched or parsed so the caller drops the
 * candidate. Never throws: fetchHtml already degrades to null.
 */
async function resolveLookasideImage(imageUrl: string): Promise<string | null> {
  const html = await fetchHtml(imageUrl)
  if (!html) return null

  const ogMatch = html.match(OG_IMAGE_PATTERN)
  if (!ogMatch?.[1]) return null
  const ogImage = decodeHtmlEntities(ogMatch[1])

  const mediaFile = ogImage.match(INSTAGRAM_MEDIA_FILE_PATTERN)?.[1]
  if (!mediaFile) return ogImage

  const uncropped = [...new Set(html.match(SCONTENT_JPG_PATTERN) ?? [])]
    .map(decodeHtmlEntities)
    .find((candidate) => {
      if (!candidate.includes(mediaFile)) return false
      const stp = candidate.match(/stp=([^&]+)/)?.[1] ?? ''
      return !CROPPED_STP_PATTERN.test(stp) && !CAPPED_STP_PATTERN.test(stp)
    })

  return uncropped ?? ogImage
}

async function searchBrandImagesForQuery(
  query: string,
  options?: SerperAuditOptions,
  budget?: LookasideBudget,
): Promise<{
  rows: BrandImageSearchResult[]
  call: SerperCallResult<SerperImageResponse>
}> {
  const call = await callSerperJson(
    SERPER_IMAGE_ENDPOINT,
    'image',
    query,
    { q: query, num: 10, gl: 'tw', hl: 'zh-TW' },
    isSerperImageResponse,
    (value) => ({
      urls: (value.images ?? []).flatMap((image) => (typeof image.imageUrl === 'string' ? [image.imageUrl] : [])),
      snippets: (value.images ?? []).flatMap((image) => (typeof image.title === 'string' ? [image.title] : [])),
    }),
    options,
  )
  const rows = new Map<string, BrandImageSearchResult>()
  for (const result of call.data?.images ?? []) {
    if (typeof result.imageUrl !== 'string' || !result.imageUrl) continue

    let url = result.imageUrl
    if (isLookasideHost(url)) {
      // Cheap checks first — never spend an HTML fetch on a candidate the
      // dimension filter or the budget would reject anyway.
      if (!passesImageDimensions(result)) continue
      if (!budget || budget.remaining <= 0) continue
      budget.remaining -= 1
      const resolved = await resolveLookasideImage(url)
      if (!resolved) continue
      url = resolved
    } else if (!shouldKeepImage(result)) {
      continue
    }

    if (!rows.has(url)) {
      rows.set(url, {
        url,
        query,
        ...(call.auditResultId ? { auditResultId: call.auditResultId } : {}),
      })
    }
  }
  return { rows: [...rows.values()], call }
}

function emptyImageOutcome(): BrandImageSearchOutcome {
  return { rows: [], callStatus: 'empty', httpStatus: null, error: null }
}

async function searchBrandImages(
  input: ImageSearchBrandInput,
  queryTemplate: QueryTemplate = DEFAULT_QUERY,
  auditResolver?: AuditResolver<ImageSearchBrandInput>,
): Promise<BrandImageSearchOutcome> {
  const brandName = typeof input === 'string' ? input : input.brandName
  const queries = typeof input === 'string' ? [queryTemplate(brandName)] : buildImageQueryVariants(input)
  const results = new Map<string, BrandImageSearchResult>()
  const baseOptions = resolveAuditOptions(auditResolver, input)
  // Shared across query variants so the cap is per brand, not per variant.
  const budget: LookasideBudget = { remaining: MAX_LOOKASIDE_RESOLUTIONS_PER_BRAND }
  // First non-succeeded/non-empty variant status, kept so a provider outage is
  // reportable even though every variant yielded zero rows.
  let firstFailure: Pick<BrandImageSearchOutcome, 'callStatus' | 'httpStatus' | 'error'> | null = null

  for (const [index, query] of queries.entries()) {
    const options = baseOptions
      ? {
          ...baseOptions,
          attempt: baseOptions.attempt ?? index + 1,
          config: {
            ...(isRecord(baseOptions.config) ? baseOptions.config : {}),
            queryVariant: index + 1,
          },
        }
      : undefined
    const { rows, call } = await searchBrandImagesForQuery(query, options, budget)
    if (call.callStatus !== 'succeeded' && call.callStatus !== 'empty') {
      firstFailure ??= {
        callStatus: call.callStatus,
        httpStatus: call.httpStatus,
        error: call.error,
      }
      continue
    }
    for (const row of rows) {
      if (!results.has(row.url)) results.set(row.url, row)
    }
  }

  const rows = [...results.values()]
  if (rows.length > 0) {
    return { rows, callStatus: 'succeeded', httpStatus: null, error: null }
  }
  if (firstFailure) {
    return { rows, ...firstFailure }
  }
  return emptyImageOutcome()
}

export async function batchSearchBrandImages(
  brandInputs: ImageSearchBrandInput[],
  concurrency = 5,
  queryTemplate: QueryTemplate = DEFAULT_QUERY,
  auditResolver?: AuditResolver<ImageSearchBrandInput>,
): Promise<Map<string, BrandImageSearchOutcome>> {
  const results = new Map<string, BrandImageSearchOutcome>()
  for (const input of brandInputs) {
    const brandName = typeof input === 'string' ? input : input.brandName
    results.set(brandName, emptyImageOutcome())
  }
  if (brandInputs.length === 0) return results

  const workerCount = Math.max(1, Math.min(concurrency, brandInputs.length))
  let nextIndex = 0
  async function worker(): Promise<void> {
    while (nextIndex < brandInputs.length) {
      const index = nextIndex
      nextIndex += 1
      const input = brandInputs[index]
      const brandName = typeof input === 'string' ? input : input.brandName
      results.set(brandName, await searchBrandImages(input, queryTemplate, auditResolver))
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

function parseMapsPlace(value: Record<string, unknown>): SerperMapPlace | null {
  const title = typeof value.title === 'string' ? value.title.trim() : ''
  if (!title) return null
  const optionalNumber = (candidate: unknown): number | undefined => {
    if (candidate === null || candidate === undefined) return undefined
    if (typeof candidate === 'string' && candidate.trim() === '') return undefined
    const number = typeof candidate === 'number' ? candidate : Number(candidate)
    return Number.isFinite(number) ? number : undefined
  }
  const latitude = optionalNumber(value.latitude)
  const longitude = optionalNumber(value.longitude)
  return {
    title,
    ...(typeof value.address === 'string' && value.address.trim() ? { address: value.address.trim() } : {}),
    ...(latitude !== undefined ? { latitude } : {}),
    ...(longitude !== undefined ? { longitude } : {}),
    ...(typeof value.website === 'string' && value.website.trim() ? { website: value.website.trim() } : {}),
    ...(typeof value.link === 'string' && value.link.trim() ? { link: value.link.trim() } : {}),
    ...(typeof value.category === 'string' && value.category.trim() ? { category: value.category.trim() } : {}),
    ...(typeof value.phoneNumber === 'string' && value.phoneNumber.trim()
      ? { phoneNumber: value.phoneNumber.trim() }
      : {}),
  }
}

export async function searchBrandMaps(
  query: string,
  auditOptions?: SerperAuditOptions,
): Promise<BrandMapsSearchResult> {
  const result = await callSerperJson(
    SERPER_MAPS_ENDPOINT,
    'maps',
    query,
    { q: query, num: 10, gl: 'tw', hl: 'zh-TW' },
    isSerperMapsResponse,
    (value) => ({
      urls: (value.places ?? []).flatMap((place) => {
        const url =
          typeof place.website === 'string' ? place.website : typeof place.link === 'string' ? place.link : null
        return url ? [url] : []
      }),
      snippets: (value.places ?? []).flatMap((place) => {
        const title = typeof place.title === 'string' ? place.title : ''
        const address = typeof place.address === 'string' ? place.address : ''
        return title || address ? [title && address ? `${title} — ${address}` : title || address] : []
      }),
    }),
    auditOptions,
  )
  return {
    places: (result.data?.places ?? []).flatMap((place) => {
      const parsed = parseMapsPlace(place)
      return parsed ? [parsed] : []
    }),
    rawResponse: result.fullResponse,
    latencyMs: result.latencyMs,
    callStatus: result.callStatus,
    httpStatus: result.httpStatus,
    error: result.error,
    ...(result.auditResultId ? { auditResultId: result.auditResultId } : {}),
  }
}
