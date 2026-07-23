import { RETAILER_NAME_NOISE, normalizeChannelName } from '@/lib/brands/channels'
import { isPhysicalRetailLocation, isRetailChainChannel } from '@/lib/brands/locations'
import { upsertEnrichedChannels } from '@/lib/services/brand-channels'
import type { Json } from '@/lib/supabase/database.types'
import type { Database } from '@/lib/supabase/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PhysicalRetailLocation, RetailChainChannel, RetailLocation } from '@/lib/types/brand'
import type { ChannelCandidate } from '@/lib/types/brand-channel'
import type { PhaseResult } from '@/lib/types/curation'
import type { DescriptionRewriteResult } from '../description-rewrite'
import type { EnrichmentTarget } from '../enrichment-target'
import {
  searchBrandMaps,
  type BrandMapsSearchResult,
  type SerperAuditOptions,
  type SerperMapPlace,
} from './scraper/serper'
import { classifyByDomain } from './scraper/input-detector'
import {
  buildPhaseResult,
  getDisplayBrandName,
  hasPatchValues,
  timePhase,
  type EnrichBrand,
  type EnrichPhase,
  type EnrichScrapedData,
  type SearchPhaseResult,
} from './types'

const MAX_EVIDENCE_EXCERPT = 500
const CITY_NAME_VARIANTS = [
  { slug: 'taipei', names: ['臺北', '台北'] },
  { slug: 'new_taipei', names: ['新北'] },
  { slug: 'taoyuan', names: ['桃園'] },
  { slug: 'taichung', names: ['臺中', '台中'] },
  { slug: 'tainan', names: ['臺南', '台南'] },
  { slug: 'kaohsiung', names: ['高雄'] },
  { slug: 'keelung', names: ['基隆'] },
  { slug: 'hsinchu_city', names: ['新竹'] },
  { slug: 'hsinchu_county', names: ['新竹'] },
  { slug: 'chiayi_city', names: ['嘉義'] },
  { slug: 'chiayi_county', names: ['嘉義'] },
  { slug: 'miaoli', names: ['苗栗'] },
  { slug: 'changhua', names: ['彰化'] },
  { slug: 'nantou', names: ['南投'] },
  { slug: 'yunlin', names: ['雲林'] },
  { slug: 'pingtung', names: ['屏東'] },
  { slug: 'yilan', names: ['宜蘭'] },
  { slug: 'hualien', names: ['花蓮'] },
  { slug: 'taitung', names: ['臺東', '台東'] },
  { slug: 'penghu', names: ['澎湖'] },
  { slug: 'kinmen', names: ['金門'] },
  { slug: 'lienchiang', names: ['連江'] },
] as const
const CITY_REGION_LABELS: Readonly<Record<string, string>> = {
  taipei: '台北',
  new_taipei: '新北',
  taoyuan: '桃園',
  taichung: '台中',
  tainan: '台南',
  kaohsiung: '高雄',
  keelung: '基隆',
  hsinchu_city: '新竹',
  hsinchu_county: '新竹縣',
  chiayi_city: '嘉義',
  chiayi_county: '嘉義縣',
  miaoli: '苗栗',
  changhua: '彰化',
  nantou: '南投',
  yunlin: '雲林',
  pingtung: '屏東',
  yilan: '宜蘭',
  hualien: '花蓮',
  taitung: '台東',
  penghu: '澎湖',
  kinmen: '金門',
  lienchiang: '連江',
}
const CLEARLY_NON_RETAIL_NAMES = ['牙醫', '牙科', '診所', '醫院', '無對外參觀', '不對外開放'] as const

type LocationEvidence = {
  source: 'official' | 'social' | 'maps' | 'description' | 'serp'
  url?: string
  auditResultId?: string
  excerpt?: string
  reference?: number
}

type LocationCandidateDecision = 'verified' | 'needs_review' | 'rejected'

type LocationCandidate = {
  location: RetailLocation
  decision: LocationCandidateDecision
  normalizedAddress: string | null
  normalizedIdentity: string
  matchReason: string
  evidence: LocationEvidence[]
  auditResultIds: string[]
  origin?: 'description' | 'existing' | 'maps'
  lookupAttempted?: boolean
}

export type ChannelsPhaseOptions = {
  brand: EnrichBrand
  phases: EnrichPhase[]
  descriptionRewrite?: DescriptionRewriteResult | null
  serpResult?: SearchPhaseResult | null
  scrapedData?: EnrichScrapedData | null
  overwrite?: boolean
  dryRun?: boolean
  target: EnrichmentTarget
  jobId?: string
  supabase: SupabaseClient<Database>
}

export type ChannelsPhaseOutput = {
  phaseResult: PhaseResult
  patch: Record<string, unknown>
  candidates: ChannelCandidate[]
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, '').toLocaleLowerCase() : ''
}

export function normalizeLocationAddress(value: unknown): string {
  return normalizeText(value).replace(/[\uFF0C,\u3002\uFF0E.\u3001\u002D\u2014_#\u865F\u6A13\u5BA4]/g, '')
}

function normalizeBranchIdentity(location: Pick<PhysicalRetailLocation, 'name' | 'city' | 'venueName'>): string {
  return [normalizeChannelName(location.name), normalizeText(location.city), normalizeText(location.venueName)].join('|')
}

function normalizeRetailerName(value: unknown): string {
  let normalized = normalizeText(value).replace(/[^\p{L}\p{N}]/gu, '')
  for (const noise of RETAILER_NAME_NOISE) {
    normalized = normalized.replaceAll(noise.toLocaleLowerCase(), '')
  }
  return normalized
}

function retailerNamesMatch(candidateName: unknown, placeTitle: unknown): boolean {
  const candidate = normalizeText(candidateName)
  const title = normalizeText(placeTitle)
  if (!candidate || !title) return false
  if (candidate.length >= 2 && title.includes(candidate)) return true

  const candidateCore = normalizeRetailerName(candidateName)
  const titleCore = normalizeRetailerName(placeTitle)
  if (candidateCore.length < 3 || titleCore.length < 3) return false
  return titleCore.includes(candidateCore)
}

function relaxedFallbackRetailerNamesMatch(candidateName: unknown, placeTitle: unknown): boolean {
  const candidate = normalizeText(candidateName)
  const candidateCore = normalizeRetailerName(candidateName)
  const titleCore = normalizeRetailerName(placeTitle)
  return candidate.length >= 4 && candidateCore.length >= 2 && titleCore.includes(candidateCore)
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text || undefined
}

function optionalCoordinate(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string' && value.trim() === '') return undefined
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : undefined
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function isOfficialUrl(value: unknown): boolean {
  return isHttpUrl(value) && classifyByDomain(value) === null
}

function urlOrigin(value: unknown): string | null {
  if (!isHttpUrl(value)) return null
  try {
    return new URL(value).origin.toLocaleLowerCase()
  } catch {
    return null
  }
}

function officialOrigins(brand: EnrichBrand, scrapedData: EnrichScrapedData | null | undefined): Set<string> {
  return new Set(
    [
      scrapedData?.websiteUrl,
      scrapedData?.purchaseWebsite,
      scrapedData?.purchase_website,
      brand.purchase_website,
      brand.purchaseWebsite,
    ].flatMap((value) => {
      if (!isOfficialUrl(value)) return []
      const origin = urlOrigin(value)
      return origin ? [origin] : []
    }),
  )
}

function isKnownOfficialUrl(value: unknown, origins: ReadonlySet<string>): boolean {
  const origin = urlOrigin(value)
  return origin !== null && origins.has(origin)
}

function isSocialUrl(value: unknown): boolean {
  return isHttpUrl(value) && classifyByDomain(value) === 'social'
}

function evidenceExcerpt(value: unknown): string | undefined {
  const text = optionalText(value)
  return text ? text.slice(0, MAX_EVIDENCE_EXCERPT) : undefined
}

function candidateFromDescription(
  stockist: NonNullable<DescriptionRewriteResult['stockists']>[number],
  evidence: LocationEvidence[],
): LocationCandidate | null {
  const name = optionalText(stockist.name)
  if (!name || stockist.type === 'chain') return null
  const location: PhysicalRetailLocation = {
    kind: 'location',
    name,
    relationshipType: 'stockist',
    ...(optionalText(stockist.address) ? { address: optionalText(stockist.address) } : {}),
    ...(optionalText(stockist.city) ? { city: optionalText(stockist.city) } : {}),
    ...(optionalText(stockist.venueName) ? { venueName: optionalText(stockist.venueName) } : {}),
    ...(optionalText(stockist.floorOrCounter) ? { floorOrCounter: optionalText(stockist.floorOrCounter) } : {}),
    verificationStatus: 'needs_review',
    confirmationStatus: 'unconfirmed',
  }
  return makeCandidate(
    location,
    'Named stockist extracted from description evidence',
    evidence,
    'needs_review',
    [],
    'description',
  )
}

function makeCandidate(
  location: PhysicalRetailLocation,
  matchReason: string,
  evidence: LocationEvidence[],
  decision: LocationCandidateDecision = 'needs_review',
  auditResultIds: string[] = [],
  origin: 'description' | 'existing' | 'maps' = 'maps',
): LocationCandidate {
  const normalizedAddress = normalizeLocationAddress(location.address) || null
  const candidateLocation: PhysicalRetailLocation = {
    ...location,
    verificationStatus: decision === 'verified' ? 'verified' : 'needs_review',
    confirmationStatus: location.confirmationStatus === 'owner_confirmed' ? 'owner_confirmed' : 'unconfirmed',
  }
  return {
    location: candidateLocation,
    decision,
    normalizedAddress,
    normalizedIdentity: normalizeBranchIdentity(location),
    matchReason,
    evidence,
    auditResultIds: [
      ...new Set([...auditResultIds, ...evidence.flatMap((item) => (item.auditResultId ? [item.auditResultId] : []))]),
    ],
    origin,
  }
}

function buildKnownEvidence(
  stockist: NonNullable<DescriptionRewriteResult['stockists']>[number],
  serpResult: SearchPhaseResult | null | undefined,
  scrapedData?: EnrichScrapedData | null,
  knownOfficialOrigins: ReadonlySet<string> = new Set(),
): LocationEvidence[] {
  const references = Array.isArray(stockist.evidenceRefs)
    ? stockist.evidenceRefs.filter((value): value is number => Number.isInteger(value) && value > 0)
    : []
  const entries = serpResult?.entries ?? []
  const evidence: LocationEvidence[] = references.flatMap((reference) => {
    const entry = entries[reference - 1]
    if (!entry) return []
    const source = isSocialUrl(entry.link)
      ? 'social'
      : isKnownOfficialUrl(entry.link, knownOfficialOrigins)
        ? 'official'
        : 'serp'
    return [
      {
        source,
        url: entry.link,
        ...(serpResult?.auditResultId ? { auditResultId: serpResult.auditResultId } : {}),
        reference,
        excerpt: evidenceExcerpt(entry.snippet ?? entry.title),
      } satisfies LocationEvidence,
    ]
  })

  if (scrapedData?.stockistPageText) {
    const sourceUrl = [
      scrapedData.websiteUrl,
      scrapedData.purchaseWebsite,
      scrapedData.purchase_website,
      scrapedData.socialInstagram,
      scrapedData.socialThreads,
      scrapedData.socialFacebook,
    ].find((url) => isKnownOfficialUrl(url, knownOfficialOrigins) || isSocialUrl(url))
    const source = isKnownOfficialUrl(sourceUrl, knownOfficialOrigins)
      ? 'official'
      : isSocialUrl(sourceUrl)
        ? 'social'
        : null
    if (sourceUrl && source) {
      evidence.push({
        source,
        url: sourceUrl,
        excerpt: evidenceExcerpt(scrapedData.stockistPageText),
      })
    }
  }
  return evidence
}

function hasAddressEvidence(address: string | undefined, evidence: LocationEvidence[]): boolean {
  const normalizedAddress = normalizeLocationAddress(address)
  if (!normalizedAddress) return false
  return evidence.some(
    (item) =>
      (item.source === 'official' || item.source === 'social') &&
      normalizeLocationAddress(item.excerpt).includes(normalizedAddress),
  )
}

function getDescriptionCandidates(
  descriptionRewrite: DescriptionRewriteResult | null | undefined,
  serpResult: SearchPhaseResult | null | undefined,
  scrapedData?: EnrichScrapedData | null,
  knownOfficialOrigins: ReadonlySet<string> = new Set(),
): LocationCandidate[] {
  return (descriptionRewrite?.stockists ?? []).flatMap((stockist) => {
    const evidence = buildKnownEvidence(stockist, serpResult, scrapedData, knownOfficialOrigins)
    const candidate = candidateFromDescription(stockist, evidence)
    if (!candidate) return []
    if (candidate.location.address && hasAddressEvidence(candidate.location.address, evidence)) {
      return [
        makeCandidate(
          candidate.location,
          'Complete address supplied with official website or official social evidence',
          evidence,
          'verified',
        ),
      ]
    }
    return [candidate]
  })
}

function isIncompletePhysicalLocation(location: PhysicalRetailLocation): boolean {
  return (
    !optionalText(location.address) ||
    optionalCoordinate(location.latitude) === undefined ||
    optionalCoordinate(location.longitude) === undefined ||
    location.verificationStatus !== 'verified'
  )
}

function samePhysicalCandidate(left: LocationCandidate, right: LocationCandidate): boolean {
  if (!isPhysicalRetailLocation(left.location) || !isPhysicalRetailLocation(right.location)) {
    return false
  }
  if (left.normalizedAddress && right.normalizedAddress && left.normalizedAddress === right.normalizedAddress) {
    return true
  }
  if (left.normalizedIdentity === right.normalizedIdentity) return true
  return (
    normalizeText(left.location.name) === normalizeText(right.location.name) &&
    (!left.location.city ||
      !right.location.city ||
      normalizeText(left.location.city) === normalizeText(right.location.city))
  )
}

function normalizedNameMatch(brandName: string, placeTitle: string, candidateName?: string): boolean {
  const title = normalizeText(placeTitle)
  if (!title) return false
  if (retailerNamesMatch(candidateName, placeTitle)) return true

  const normalizedBrandName = normalizeText(brandName)
  if (normalizedBrandName && title.includes(normalizedBrandName)) return true
  const parts = brandName.toLocaleLowerCase().match(/[a-z0-9]+|\p{Script=Han}+/gu)?.map(normalizeText) ?? []
  if (parts.length > 1 && parts.every((part) => title.includes(part))) return true
  return parts
    .filter((part) => (/^\p{Script=Han}+$/u.test(part) ? part.length >= 3 : part.length >= 4))
    .some((part) => title.includes(part))
}

function hasConflictingNamedCity(target: LocationCandidate, place: SerperMapPlace): boolean {
  if (!isPhysicalRetailLocation(target.location)) return false
  const targetName = normalizeText(target.location.name)
  const expectedCity =
    CITY_NAME_VARIANTS.find(({ names }) => names.some((variant) => targetName.includes(variant))) ??
    CITY_NAME_VARIANTS.find(({ slug }) => slug === target.location.city)
  if (!expectedCity) return false
  const placeText = normalizeText(`${place.title} ${place.address ?? ''}`)
  return !expectedCity.names.some((variant) => placeText.includes(variant))
}

function inferCityFromAddress(address: string): (typeof CITY_NAME_VARIANTS)[number]['slug'] | undefined {
  const normalizedAddress = normalizeText(address)
  const ambiguousCounty = [
    { slug: 'hsinchu_county' as const, name: '新竹縣' },
    { slug: 'chiayi_county' as const, name: '嘉義縣' },
  ].find(({ name }) => normalizedAddress.includes(normalizeText(name)))
  if (ambiguousCounty) return ambiguousCounty.slug
  if (normalizedAddress.includes(normalizeText('新竹市'))) return 'hsinchu_city'
  if (normalizedAddress.includes(normalizeText('嘉義市'))) return 'chiayi_city'
  return CITY_NAME_VARIANTS.find(({ names }) =>
    names.some((variant) => normalizedAddress.includes(normalizeText(variant))),
  )?.slug
}

function isClearlyNonRetailPlace(place: SerperMapPlace): boolean {
  const text = normalizeText(`${place.title} ${place.category ?? ''}`)
  return CLEARLY_NON_RETAIL_NAMES.some((marker) => text.includes(normalizeText(marker)))
}

function uniqueAddressPlaces(places: SerperMapPlace[]): SerperMapPlace[] {
  const seen = new Set<string>()
  return places.filter((place) => {
    const address = normalizeLocationAddress(place.address)
    if (!address || seen.has(address)) return false
    seen.add(address)
    return true
  })
}

function getFallbackPlaces(
  brandName: string,
  target: LocationCandidate,
  result: BrandMapsSearchResult,
): SerperMapPlace[] {
  if (!isPhysicalRetailLocation(target.location)) return []
  const eligible = result.places.filter((place) => optionalText(place.address) && !isClearlyNonRetailPlace(place))
  if (target.normalizedAddress) {
    const addressMatches = eligible.filter(
      (place) => normalizeLocationAddress(place.address) === target.normalizedAddress,
    )
    if (addressMatches.length > 0) return uniqueAddressPlaces(addressMatches)
  }
  const retailerMatches = eligible.filter((place) => retailerNamesMatch(target.location.name, place.title))
  if (retailerMatches.length > 0) return uniqueAddressPlaces(retailerMatches)
  const relaxedRetailerMatches = eligible.filter((place) =>
    relaxedFallbackRetailerNamesMatch(target.location.name, place.title),
  )
  if (relaxedRetailerMatches.length > 0) return uniqueAddressPlaces(relaxedRetailerMatches)
  return uniqueAddressPlaces(
    eligible.filter(
      (place) => !hasConflictingNamedCity(target, place) && normalizedNameMatch(brandName, place.title),
    ),
  )
}

function mapPlaceLocation(
  place: SerperMapPlace,
  candidate: LocationCandidate | undefined,
): PhysicalRetailLocation | null {
  const address = optionalText(place.address)
  if (!address) return null
  const physicalCandidate = candidate && isPhysicalRetailLocation(candidate.location) ? candidate.location : undefined
  const name = physicalCandidate?.name ?? optionalText(place.title)
  if (!name) return null
  const city = inferCityFromAddress(address) ?? physicalCandidate?.city
  return {
    kind: 'location',
    name,
    relationshipType: physicalCandidate?.relationshipType ?? 'brand_store',
    address,
    ...(city ? { city } : {}),
    ...(physicalCandidate?.venueName ? { venueName: physicalCandidate.venueName } : {}),
    ...(physicalCandidate?.floorOrCounter ? { floorOrCounter: physicalCandidate.floorOrCounter } : {}),
    ...(optionalCoordinate(place.latitude) !== undefined ? { latitude: optionalCoordinate(place.latitude) } : {}),
    ...(optionalCoordinate(place.longitude) !== undefined ? { longitude: optionalCoordinate(place.longitude) } : {}),
    verificationStatus: 'needs_review',
    confirmationStatus: 'unconfirmed',
  }
}

function mapEvidence(result: BrandMapsSearchResult, place: SerperMapPlace): LocationEvidence[] {
  const url = place.website ?? place.link
  return result.auditResultId
    ? [
        {
          source: 'maps',
          auditResultId: result.auditResultId,
          ...(url ? { url } : {}),
        },
      ]
    : [{ source: 'maps', ...(url ? { url } : {}) }]
}

function getSharedRetailerUrl(places: SerperMapPlace[]): string | undefined {
  const urls = places.flatMap((place) => {
    const url = place.website ?? place.link
    const origin = urlOrigin(url)
    return url && origin ? [{ url, origin }] : []
  })
  const originCounts = new Map<string, number>()
  for (const { origin } of urls) {
    originCounts.set(origin, (originCounts.get(origin) ?? 0) + 1)
  }
  const sharedOrigin = [...originCounts].find(([, count]) => count >= 2)?.[0]
  return urls.find(({ origin }) => origin === sharedOrigin)?.url
}

function getRetailChainCandidate(
  target: LocationCandidate,
  result: BrandMapsSearchResult,
  branchPlaces: SerperMapPlace[],
): LocationCandidate | null {
  if (
    !isPhysicalRetailLocation(target.location) ||
    optionalText(target.location.address) ||
    target.location.confirmationStatus === 'owner_confirmed'
  ) {
    return null
  }

  const distinctAddresses = new Set(branchPlaces.map((place) => normalizeLocationAddress(place.address)))
  if (distinctAddresses.size < 2) return null

  const retailerUrl = getSharedRetailerUrl(branchPlaces)
  const location: RetailChainChannel = {
    kind: 'retail_chain',
    name: target.location.name,
    ...(retailerUrl ? { retailerUrl } : {}),
  }
  const evidence = branchPlaces.flatMap((place) => mapEvidence(result, place))
  return {
    location,
    decision: 'verified',
    normalizedAddress: null,
    normalizedIdentity: `retail_chain|${normalizeText(location.name)}`,
    matchReason: 'Maps lookup returned multiple matching branches with distinct addresses',
    evidence,
    auditResultIds: [
      ...new Set([
        ...(result.auditResultId ? [result.auditResultId] : []),
        ...evidence.flatMap((item) => (item.auditResultId ? [item.auditResultId] : [])),
      ]),
    ],
    origin: target.origin,
    lookupAttempted: true,
  }
}

function applyFallbackPlace(
  candidates: LocationCandidate[],
  target: LocationCandidate,
  result: BrandMapsSearchResult,
  place: SerperMapPlace,
  knownOfficialOrigins: ReadonlySet<string>,
): LocationCandidate[] {
  const index = candidates.findIndex((candidate) => samePhysicalCandidate(candidate, target))
  if (index < 0) return candidates
  const location = mapPlaceLocation(place, target)
  if (!location) return candidates
  const matchingAddress = Boolean(
    target.origin !== 'maps' &&
      target.normalizedAddress &&
      normalizeLocationAddress(place.address) === target.normalizedAddress,
  )
  const mapsOfficiallyLinked = [place.website, place.link].some((url) =>
    isKnownOfficialUrl(url, knownOfficialOrigins),
  )
  const verified = Boolean(mapsOfficiallyLinked || matchingAddress)
  const next = [...candidates]
  next[index] = {
    ...makeCandidate(
      location,
      verified
        ? 'Fallback Maps result matched the queried stockist and was corroborated'
        : 'Fallback Maps result matched the queried stockist but lacks official corroboration',
      [...target.evidence, ...mapEvidence(result, place)],
      verified ? 'verified' : 'needs_review',
      result.auditResultId ? [result.auditResultId] : [],
      target.origin,
    ),
    lookupAttempted: true,
  }
  return next
}

function rejectClearlyNonRetailTarget(
  candidates: LocationCandidate[],
  target: LocationCandidate,
  result: BrandMapsSearchResult,
): LocationCandidate[] {
  if (
    !isPhysicalRetailLocation(target.location) ||
    !result.places.some(
      (place) => isClearlyNonRetailPlace(place) && retailerNamesMatch(target.location.name, place.title),
    )
  ) {
    return candidates
  }
  const index = candidates.findIndex((candidate) => samePhysicalCandidate(candidate, target))
  if (index < 0) return candidates
  const next = [...candidates]
  next[index] = {
    ...target,
    decision: 'rejected',
    matchReason: 'Maps result is clearly not a public retail location',
    evidence: [
      ...target.evidence,
      ...(result.auditResultId ? [{ source: 'maps' as const, auditResultId: result.auditResultId }] : []),
    ],
    auditResultIds: [...new Set([...target.auditResultIds, ...(result.auditResultId ? [result.auditResultId] : [])])],
    lookupAttempted: true,
  }
  return next
}

function markLookupAttempt(
  candidates: LocationCandidate[],
  target: LocationCandidate,
  result: BrandMapsSearchResult,
): LocationCandidate[] {
  const index = candidates.findIndex((candidate) => samePhysicalCandidate(candidate, target))
  if (index < 0) return candidates

  const current = candidates[index]
  if (!current || !isPhysicalRetailLocation(current.location)) return candidates
  const auditEvidence: LocationEvidence[] = result.auditResultId
    ? [{ source: 'maps', auditResultId: result.auditResultId }]
    : []
  const attemptedLocation: PhysicalRetailLocation = {
    ...current.location,
    verificationStatus: current.decision === 'verified' ? 'verified' : 'needs_review',
  }
  const next = [...candidates]
  next[index] = {
    ...current,
    location: attemptedLocation,
    matchReason:
      current.decision === 'verified'
        ? current.matchReason
        : 'Maps lookup completed without a safely corroborated match',
    evidence: [...current.evidence, ...auditEvidence],
    auditResultIds: [...new Set([...current.auditResultIds, ...(result.auditResultId ? [result.auditResultId] : [])])],
    lookupAttempted: true,
  }
  return next
}

function applyMapsMatches(
  brandName: string,
  candidates: LocationCandidate[],
  result: BrandMapsSearchResult,
  knownOfficialOrigins: ReadonlySet<string>,
): LocationCandidate[] {
  const next = [...candidates]
  for (const place of result.places) {
    if (isClearlyNonRetailPlace(place)) continue
    const placeAddress = normalizeLocationAddress(place.address)
    const candidateIndex = next.findIndex((candidate) => {
      if (!isPhysicalRetailLocation(candidate.location)) return false
      if (!normalizedNameMatch(brandName, place.title, candidate.location.name)) return false
      const nameMatches = retailerNamesMatch(candidate.location.name, place.title)
      const addressMatches = Boolean(
        placeAddress && candidate.normalizedAddress && placeAddress === candidate.normalizedAddress,
      )
      const addressConflicts = Boolean(
        placeAddress && candidate.normalizedAddress && placeAddress !== candidate.normalizedAddress,
      )
      if (addressConflicts) return false
      return nameMatches || addressMatches
    })
    const candidate = candidateIndex >= 0 ? next[candidateIndex] : undefined
    const candidateName =
      candidate && isPhysicalRetailLocation(candidate.location) ? candidate.location.name : undefined
    if (!normalizedNameMatch(brandName, place.title, candidateName)) continue
    const location = mapPlaceLocation(place, candidate)
    if (!location) continue
    const mapsEvidence = mapEvidence(result, place)
    const matchingAddress = Boolean(
      candidate?.origin !== 'maps' &&
        candidate?.normalizedAddress &&
        normalizeLocationAddress(place.address) === candidate.normalizedAddress,
    )
    const mapsOfficiallyLinked = [place.website, place.link].some((url) =>
      isKnownOfficialUrl(url, knownOfficialOrigins),
    )
    const verified = Boolean(mapsOfficiallyLinked || matchingAddress)
    const nextCandidate = makeCandidate(
      location,
      verified
        ? 'Maps branch matched the brand and was corroborated by an official source or extracted address'
        : 'Maps branch matched by name but lacks official corroboration',
      [...(candidate?.evidence ?? []), ...mapsEvidence],
      verified ? 'verified' : 'needs_review',
      result.auditResultId ? [result.auditResultId] : [],
      candidate?.origin ?? 'maps',
    )
    if (candidateIndex >= 0 && candidate?.decision === 'verified' && !verified) {
      next.push(nextCandidate)
    } else if (candidateIndex >= 0) next[candidateIndex] = nextCandidate
    else next.push(nextCandidate)
  }
  return next
}


function getLocationRegionLabel(location: PhysicalRetailLocation): string | undefined {
  const city = location.city ?? (location.address ? inferCityFromAddress(location.address) : undefined)
  return city ? CITY_REGION_LABELS[city] ?? city : undefined
}

function getCategoryLabel(location: PhysicalRetailLocation): string | undefined {
  switch (location.relationshipType) {
    case 'brand_store':
      return '品牌直營'
    case 'department_counter':
      return '百貨專櫃'
    case 'stockist':
      return '選品店'
    default:
      return undefined
  }
}

function getCandidateUrl(candidate: LocationCandidate): string | undefined {
  if (isRetailChainChannel(candidate.location)) return optionalText(candidate.location.retailerUrl)
  return candidate.evidence.find((item) => item.source === 'maps' && item.url)?.url
}

function toChannelCandidate(candidate: LocationCandidate): ChannelCandidate {
  const location = candidate.location
  const name = location.name.trim()
  const chain = isRetailChainChannel(location)
  const regionLabel = chain
    ? optionalText(location.availabilityNote) ?? '全台多間門市'
    : getLocationRegionLabel(location)
  const url = getCandidateUrl(candidate)

  return {
    name,
    normalizedName: normalizeChannelName(name),
    channelType: 'offline',
    ...(!chain
      ? {
          categoryLabel: getCategoryLabel(location),
          address: optionalText(location.address) ?? null,
        }
      : { address: null }),
    ...(regionLabel ? { regionLabel } : {}),
    ...(url ? { url } : {}),
  }
}


function toChannelCandidates(candidates: LocationCandidate[]): ChannelCandidate[] {
  const byNormalizedName = new Map<string, ChannelCandidate>()
  for (const candidate of candidates) {
    if (candidate.decision === 'rejected') continue
    const channel = toChannelCandidate(candidate)
    const current = byNormalizedName.get(channel.normalizedName)
    if (!current) {
      byNormalizedName.set(channel.normalizedName, channel)
      continue
    }

    const shouldReplace =
      (!current.address && Boolean(channel.address)) ||
      (current.regionLabel !== '全台多間門市' && channel.regionLabel === '全台多間門市')
    if (shouldReplace) {
      byNormalizedName.set(channel.normalizedName, channel)
    } else if (!current.url && channel.url) {
      byNormalizedName.set(channel.normalizedName, { ...current, url: channel.url })
    }
  }
  return [...byNormalizedName.values()]
}

async function resolveChannelIds(
  options: ChannelsPhaseOptions,
  candidates: ChannelCandidate[],
): Promise<Map<string, string>> {
  if (options.target.type !== 'brand' || options.dryRun || candidates.length === 0) {
    return new Map()
  }

  const normalizedNames = [...new Set(candidates.map((candidate) => candidate.normalizedName))]
  const { data, error } = await options.supabase
    .from('brand_channels')
    .select('id, normalized_name')
    .eq('brand_id', options.target.id)
    .in('normalized_name', normalizedNames)
  if (error) throw error

  return new Map(
    (data ?? []).flatMap((row) =>
      row.id && row.normalized_name ? [[row.normalized_name, row.id] as const] : [],
    ),
  )
}

async function persistChannelCandidates(
  options: ChannelsPhaseOptions,
  candidates: LocationCandidate[],
  channelIds: ReadonlyMap<string, string>,
): Promise<void> {
  if (options.dryRun || candidates.length === 0) return

  const rows = candidates.map((candidate) => {
    const channel = toChannelCandidate(candidate)
    return {
      ...(options.target.type === 'brand'
        ? { brand_id: options.target.id, submission_id: null }
        : { brand_id: null, submission_id: options.target.id }),
      channel_id: channelIds.get(channel.normalizedName) ?? null,
      job_id: options.jobId ?? null,
      location: channel as unknown as Json,
      normalized_address: candidate.normalizedAddress,
      normalized_identity: candidate.normalizedIdentity,
      verification_decision: candidate.decision,
      match_reason: candidate.matchReason,
      evidence: candidate.evidence as unknown as Json,
      audit_result_ids: candidate.auditResultIds,
    }
  })
  const { error } = await options.supabase.from('brand_location_candidates').insert(rows)
  if (error) throw error
}

export async function runChannelsPhase(options: ChannelsPhaseOptions): Promise<ChannelsPhaseOutput> {
  if (!options.phases.includes('locations')) {
    return {
      phaseResult: buildPhaseResult('locations', 'skipped', [], 0, undefined, 'locations phase not requested'),
      patch: {},
      candidates: [],
    }
  }

  const { result, durationMs } = await timePhase(async () => {
    const knownOfficialOrigins = officialOrigins(options.brand, options.scrapedData)
    const initialCandidates = getDescriptionCandidates(
      options.descriptionRewrite,
      options.serpResult,
      options.scrapedData,
      knownOfficialOrigins,
    )
    const mapsOptions: SerperAuditOptions = {
      target: options.target,
      ...(options.jobId ? { jobId: options.jobId } : {}),
      supabase: options.supabase,
      dryRun: options.dryRun,
      config: { phase: 'locations', queryKind: 'broad' },
    }
    const broadQuery = [getDisplayBrandName(options.brand), options.brand.city].filter(Boolean).join(' ')
    const broadResult = await searchBrandMaps(broadQuery, mapsOptions)
    let candidates = applyMapsMatches(
      getDisplayBrandName(options.brand),
      initialCandidates,
      broadResult,
      knownOfficialOrigins,
    )

    const needsFallback = (candidate: LocationCandidate) =>
      isPhysicalRetailLocation(candidate.location) && isIncompletePhysicalLocation(candidate.location)
    const unresolved = candidates
      .filter((candidate) => candidate.decision !== 'verified')
      .filter(needsFallback)
    const FALLBACK_CONCURRENCY = 5
    const fallbackResults: BrandMapsSearchResult[] = new Array(unresolved.length)
    const unresolvedQueue = unresolved.map((candidate, index) => ({ candidate, index }))
    const worker = async () => {
      while (unresolvedQueue.length > 0) {
        const item = unresolvedQueue.shift()
        if (!item) break
        const { candidate, index } = item
        fallbackResults[index] = await searchBrandMaps(
          [getDisplayBrandName(options.brand), candidate.location.name, candidate.location.city]
            .filter(Boolean)
            .join(' '),
          {
            ...mapsOptions,
            attempt: index + 2,
            config: {
              phase: 'locations',
              queryKind: 'fallback',
              candidate: candidate.location.name,
            },
          },
        )
      }
    }
    await Promise.all(Array.from({ length: Math.min(FALLBACK_CONCURRENCY, unresolved.length) }, () => worker()))
    for (const [index, fallbackResult] of fallbackResults.entries()) {
      const target = unresolved.at(index)
      if (!target) continue
      const fallbackPlaces = getFallbackPlaces(getDisplayBrandName(options.brand), target, fallbackResult)
      const chainCandidate = getRetailChainCandidate(target, fallbackResult, fallbackPlaces)
      if (chainCandidate) {
        const targetIndex = candidates.findIndex((candidate) => samePhysicalCandidate(candidate, target))
        if (targetIndex >= 0) candidates[targetIndex] = chainCandidate
        continue
      }
      if (fallbackPlaces.length === 1) {
        const place = fallbackPlaces.at(0)
        if (place) {
          candidates = applyFallbackPlace(candidates, target, fallbackResult, place, knownOfficialOrigins)
          continue
        }
      }
      const rejected = rejectClearlyNonRetailTarget(candidates, target, fallbackResult)
      candidates = rejected === candidates ? markLookupAttempt(candidates, target, fallbackResult) : rejected
    }

    const channelCandidates = toChannelCandidates(candidates)
    if (options.target.type === 'brand' && !options.dryRun && channelCandidates.length > 0) {
      const upsertResult = await upsertEnrichedChannels(options.target.id, channelCandidates)
      if (!upsertResult.ok) {
        throw new Error('Failed to upsert enriched channels: ' + upsertResult.code)
      }
    }
    const channelIds = await resolveChannelIds(options, channelCandidates)
    await persistChannelCandidates(options, candidates, channelIds)
    const patch = channelCandidates.length > 0 ? { channels: channelCandidates } : {}
    return { candidates: channelCandidates, patch }
  })

  return {
    phaseResult: buildPhaseResult(
      'locations',
      hasPatchValues(result.patch) ? 'succeeded' : 'skipped',
      hasPatchValues(result.patch) ? ['channels'] : [],
      durationMs,
    ),
    patch: result.patch,
    candidates: result.candidates,
  }
}
