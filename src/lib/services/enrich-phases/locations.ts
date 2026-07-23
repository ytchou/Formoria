import { isPhysicalRetailLocation, normalizeRetailLocations } from '@/lib/brands/locations'
import type { Json } from '@/lib/supabase/database.types'
import type { Database } from '@/lib/supabase/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PhysicalRetailLocation, RetailLocation } from '@/lib/types/brand'
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

const MAX_MAPS_FALLBACKS = 3
const MAX_EVIDENCE_EXCERPT = 500

type LocationEvidence = {
  source: 'official' | 'social' | 'maps' | 'description' | 'serp'
  url?: string
  auditResultId?: string
  excerpt?: string
  reference?: number
}

type LocationCandidateDecision = 'verified' | 'needs_review' | 'rejected'

export type LocationCandidate = {
  location: PhysicalRetailLocation
  decision: LocationCandidateDecision
  normalizedAddress: string | null
  normalizedIdentity: string
  matchReason: string
  evidence: LocationEvidence[]
  auditResultIds: string[]
  origin?: 'description' | 'maps'
}

export type LocationsPhaseOptions = {
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

export type LocationsPhaseOutput = {
  phaseResult: PhaseResult
  patch: Record<string, unknown>
  candidates: LocationCandidate[]
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, '').toLocaleLowerCase() : ''
}

export function normalizeLocationAddress(value: unknown): string {
  return normalizeText(value).replace(/[，,。．.、\-—_#號號樓室]/g, '')
}

function normalizeBranchIdentity(location: Pick<PhysicalRetailLocation, 'name' | 'city' | 'venueName'>): string {
  return [normalizeText(location.name), normalizeText(location.city), normalizeText(location.venueName)].join('|')
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
  origin: 'description' | 'maps' = 'maps',
): LocationCandidate {
  const normalizedAddress = normalizeLocationAddress(location.address) || null
  return {
    location: {
      ...location,
      verificationStatus: decision === 'verified' ? 'verified' : 'needs_review',
      confirmationStatus: location.confirmationStatus === 'owner_confirmed' ? 'owner_confirmed' : 'unconfirmed',
    },
    decision,
    normalizedAddress,
    normalizedIdentity: normalizeBranchIdentity(location),
    matchReason,
    evidence,
    auditResultIds: [
      ...new Set([
        ...auditResultIds,
        ...evidence.flatMap((item) => (item.auditResultId ? [item.auditResultId] : [])),
      ]),
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

function normalizedNameMatch(brandName: string, placeTitle: string, candidateName?: string): boolean {
  const title = normalizeText(placeTitle)
  const brand = normalizeText(brandName)
  const candidate = normalizeText(candidateName)
  if (!title || !brand) return false
  return title.includes(brand) || (candidate.length >= 2 && title.includes(candidate))
}

function mapPlaceLocation(
  place: SerperMapPlace,
  candidate: LocationCandidate | undefined,
): PhysicalRetailLocation | null {
  const address = optionalText(place.address)
  if (!address) return null
  const name = candidate?.location.name ?? optionalText(place.title)
  if (!name) return null
  return {
    kind: 'location',
    name,
    relationshipType: candidate?.location.relationshipType ?? 'brand_store',
    address,
    ...(candidate?.location.city ? { city: candidate.location.city } : {}),
    ...(candidate?.location.venueName ? { venueName: candidate.location.venueName } : {}),
    ...(candidate?.location.floorOrCounter ? { floorOrCounter: candidate.location.floorOrCounter } : {}),
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

function applyMapsMatches(
  brandName: string,
  candidates: LocationCandidate[],
  result: BrandMapsSearchResult,
  knownOfficialOrigins: ReadonlySet<string>,
): LocationCandidate[] {
  const next = [...candidates]
  for (const place of result.places) {
    const placeAddress = normalizeLocationAddress(place.address)
    const candidateIndex = next.findIndex((candidate) => {
      if (!normalizedNameMatch(brandName, place.title, candidate.location.name)) return false
      const candidateName = normalizeText(candidate.location.name)
      const title = normalizeText(place.title)
      const nameMatches = candidateName.length >= 2 && title.includes(candidateName)
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
    if (!normalizedNameMatch(brandName, place.title, candidate?.location.name)) continue
    const location = mapPlaceLocation(place, candidate)
    if (!location) continue
    const mapsEvidence = mapEvidence(result, place)
    const matchingAddress =
      candidate?.origin === 'description' &&
      candidate.normalizedAddress &&
      normalizeLocationAddress(place.address) === candidate.normalizedAddress
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

export function mergeLocationCandidates(existing: unknown, candidates: readonly LocationCandidate[]): RetailLocation[] {
  const merged = normalizeRetailLocations(existing)
  const findExisting = (candidate: LocationCandidate): number => {
    if (candidate.normalizedAddress) {
      const byAddress = merged.findIndex(
        (location) =>
          isPhysicalRetailLocation(location) &&
          normalizeLocationAddress(location.address) === candidate.normalizedAddress,
      )
      if (byAddress >= 0) return byAddress
    }
    const byIdentity = merged.findIndex(
      (location) =>
        isPhysicalRetailLocation(location) && normalizeBranchIdentity(location) === candidate.normalizedIdentity,
    )
    if (byIdentity >= 0) return byIdentity

    const name = normalizeText(candidate.location.name)
    const matches = merged.flatMap((location, index) =>
      isPhysicalRetailLocation(location) && normalizeText(location.name) === name ? [index] : [],
    )
    return matches.length === 1 ? matches[0] : -1
  }

  for (const candidate of candidates) {
    if (candidate.decision === 'rejected') continue
    const index = findExisting(candidate)
    if (index < 0) {
      merged.push(
        candidate.decision === 'verified'
          ? candidate.location
          : {
              kind: 'location',
              name: candidate.location.name,
              relationshipType: candidate.location.relationshipType,
              verificationStatus: 'needs_review',
              confirmationStatus: 'unconfirmed',
            },
      )
      continue
    }
    const existingLocation = merged[index]
    if (!isPhysicalRetailLocation(existingLocation)) continue
    if (candidate.decision !== 'verified') continue
    const existingAddress = normalizeLocationAddress(existingLocation.address)
    if (
      existingAddress &&
      candidate.normalizedAddress &&
      existingAddress !== candidate.normalizedAddress
    ) {
      continue
    }
    const next = { ...existingLocation }
    const candidateLocation = candidate.location
    for (const key of [
      'address',
      'city',
      'district',
      'venueName',
      'floorOrCounter',
      'availabilityNote',
      'latitude',
      'longitude',
    ] as const) {
      const current = next[key]
      const incoming = candidateLocation[key]
      if ((current === undefined || current === null || current === '') && incoming !== undefined) {
        next[key] = incoming as never
      }
    }
    if (candidate.decision === 'verified') next.verificationStatus = 'verified'
    if (next.confirmationStatus !== 'owner_confirmed') next.confirmationStatus = 'unconfirmed'
    merged[index] = next
  }
  return merged
}

async function persistLocationCandidates(
  options: LocationsPhaseOptions,
  candidates: LocationCandidate[],
): Promise<void> {
  if (options.dryRun || candidates.length === 0) return
  const rows = candidates.map((candidate) => ({
    ...(options.target.type === 'brand'
      ? { brand_id: options.target.id, submission_id: null }
      : { brand_id: null, submission_id: options.target.id }),
    job_id: options.jobId ?? null,
    location: candidate.location as unknown as Json,
    normalized_address: candidate.normalizedAddress,
    normalized_identity: candidate.normalizedIdentity,
    verification_decision: candidate.decision,
    match_reason: candidate.matchReason,
    evidence: candidate.evidence as unknown as Json,
    audit_result_ids: candidate.auditResultIds,
  }))
  const { error } = await options.supabase.from('brand_location_candidates').insert(rows)
  if (error) throw error
}

export async function runLocationsPhase(options: LocationsPhaseOptions): Promise<LocationsPhaseOutput> {
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

    const unresolved = candidates
      .filter((candidate) => candidate.decision !== 'verified')
      .filter((candidate) => candidate.location.name)
      .slice(0, MAX_MAPS_FALLBACKS)
    const fallbackResults = await Promise.all(
      unresolved.map((candidate, index) =>
        searchBrandMaps(
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
        ),
      ),
    )
    for (const fallbackResult of fallbackResults) {
      candidates = applyMapsMatches(
        getDisplayBrandName(options.brand),
        candidates,
        fallbackResult,
        knownOfficialOrigins,
      )
    }

    const mergedLocations = mergeLocationCandidates(options.brand.retail_locations, candidates)
    await persistLocationCandidates(options, candidates)
    const patch =
      candidates.length > 0 || options.brand.retail_locations != null ? { retail_locations: mergedLocations } : {}
    return { candidates, patch }
  })

  return {
    phaseResult: buildPhaseResult(
      'locations',
      hasPatchValues(result.patch) ? 'succeeded' : 'skipped',
      hasPatchValues(result.patch) ? ['retail_locations'] : [],
      durationMs,
    ),
    patch: result.patch,
    candidates: result.candidates,
  }
}
