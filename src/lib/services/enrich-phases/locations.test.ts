import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isPublicMappableRetailLocation,
  isPublicRetailLocation,
  normalizeRetailLocations,
} from '@/lib/brands/locations'
import type { LocationCandidate, LocationsPhaseOptions } from './locations'
import { mergeLocationCandidates, normalizeLocationAddress, runLocationsPhase } from './locations'
import type { BrandMapsSearchResult } from './scraper/serper'
import type { DescriptionRewriteResult } from '../description-rewrite'

const mocks = vi.hoisted(() => ({ searchBrandMaps: vi.fn() }))

vi.mock('./scraper/serper', () => ({ searchBrandMaps: mocks.searchBrandMaps }))

function mapsResult(places: BrandMapsSearchResult['places'] = []): BrandMapsSearchResult {
  return {
    places,
    rawResponse: null,
    latencyMs: 1,
    callStatus: places.length > 0 ? 'succeeded' : 'empty',
    httpStatus: 200,
    error: null,
    auditResultId: 'audit-1',
  }
}

function phaseOptions(overrides: Partial<LocationsPhaseOptions> = {}): LocationsPhaseOptions {
  return {
    brand: {
      id: 'submission-1',
      slug: 'submission-1',
      name: 'Littdlework',
      city: 'taipei',
      purchase_website: 'https://littdlework.example',
      retail_locations: null,
    },
    phases: ['locations'],
    dryRun: true,
    target: { type: 'submission' as const, id: 'submission-1' },
    supabase: {} as never,
    ...overrides,
  }
}

function candidate(overrides: Partial<LocationCandidate> = {}): LocationCandidate {
  const location = {
    kind: 'location' as const,
    name: '永康旗艦店',
    relationshipType: 'brand_store' as const,
    address: '臺北市大安區永康街 1 號',
    city: 'taipei',
    latitude: 25.033,
    longitude: 121.565,
    verificationStatus: 'verified' as const,
    confirmationStatus: 'unconfirmed' as const,
  }
  return {
    location,
    decision: 'verified',
    normalizedAddress: normalizeLocationAddress(location.address),
    normalizedIdentity: '永康旗艦店|taipei|',
    matchReason: 'official source',
    evidence: [{ source: 'official', url: 'https://littdlework.example/stores' }],
    auditResultIds: ['audit-1'],
    ...overrides,
  }
}

function descriptionRewrite(overrides: Partial<DescriptionRewriteResult>): DescriptionRewriteResult {
  return {
    description_zh: null,
    description_en: null,
    description: null,
    blurb_zh: null,
    blurb_en: null,
    priceRange: null,
    productTags: [],
    productTagsEn: [],
    city: null,
    foundingYear: null,
    reputationSummary: null,
    faq: null,
    stockists: null,
    mitIndicators: null,
    validationRejections: [],
    ...overrides,
  }
}

describe('location candidate merge', () => {
  it('upgrades an existing same-name row without duplicating or overwriting protected values', () => {
    const existing = normalizeRetailLocations([
      {
        kind: 'location',
        name: '永康旗艦店',
        relationshipType: 'brand_store',
        city: 'taipei',
        confirmationStatus: 'owner_confirmed',
        availabilityNote: '管理員備註',
      },
      {
        kind: 'location',
        name: '其他門市',
        relationshipType: 'stockist',
        confirmationStatus: 'unconfirmed',
      },
      {
        kind: 'location',
        name: '第三方選物店',
        relationshipType: 'stockist',
        confirmationStatus: 'unconfirmed',
      },
      {
        kind: 'retail_chain',
        name: '其他連鎖通路',
      },
    ])
    const merged = mergeLocationCandidates(existing, [candidate()])

    expect(merged).toHaveLength(4)
    const first = merged.at(0)
    expect(first).toMatchObject({
      name: '永康旗艦店',
      address: '臺北市大安區永康街 1 號',
      latitude: 25.033,
      longitude: 121.565,
      confirmationStatus: 'owner_confirmed',
      availabilityNote: '管理員備註',
      verificationStatus: 'verified',
    })
    expect(merged.map((location) => location.name)).toEqual(['永康旗艦店', '其他門市', '第三方選物店', '其他連鎖通路'])
  })

  it('does not mark a same-identity row verified when its address conflicts', () => {
    const existing = normalizeRetailLocations([
      {
        kind: 'location',
        name: '永康旗艦店',
        relationshipType: 'brand_store',
        city: 'taipei',
        venueName: '永康商場',
        address: '臺北市大安區舊址 9 號',
        verificationStatus: 'needs_review',
        confirmationStatus: 'unconfirmed',
      },
    ])
    const incoming = candidate({
      location: {
        ...candidate().location,
        city: 'taipei',
        venueName: '永康商場',
        address: '臺北市大安區新址 10 號',
      },
      normalizedAddress: normalizeLocationAddress('臺北市大安區新址 10 號'),
      normalizedIdentity: '永康旗艦店|taipei|永康商場',
    })

    const merged = mergeLocationCandidates(existing, [incoming])

    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      address: '臺北市大安區舊址 9 號',
      verificationStatus: 'needs_review',
    })
  })

  it('keeps needs-review addresses in private data but excludes them from public eligibility', () => {
    const [location] = normalizeRetailLocations([
      {
        kind: 'location',
        name: '待核對門市',
        relationshipType: 'stockist',
        address: '臺北市待核對路 2 號',
        verificationStatus: 'needs_review',
        confirmationStatus: 'unconfirmed',
      },
    ])

    expect(location && isPublicRetailLocation(location)).toBe(false)
    expect(location && isPublicMappableRetailLocation(location)).toBe(false)
  })

  it('does not publish a weak candidate address until an admin accepts it', () => {
    const merged = mergeLocationCandidates([], [candidate({ decision: 'needs_review' })])
    const location = merged.at(0)

    expect(location).toMatchObject({
      name: '永康旗艦店',
      verificationStatus: 'needs_review',
      confirmationStatus: 'unconfirmed',
    })
    expect(location && 'address' in location ? location.address : undefined).toBeUndefined()
  })
})

describe('locations phase evidence and call bounds', () => {
  beforeEach(() => {
    mocks.searchBrandMaps.mockReset()
    mocks.searchBrandMaps.mockResolvedValue(mapsResult())
  })

  it('always makes one broad Maps call and caps unresolved fallbacks at three', async () => {
    const stockists = ['A 店', 'B 店', 'C 店', 'D 店', 'E 店'].map((name) => ({
      name,
      city: 'taipei',
      type: 'independent' as const,
    }))

    await runLocationsPhase(phaseOptions({ descriptionRewrite: descriptionRewrite({ stockists }) }))

    expect(mocks.searchBrandMaps).toHaveBeenCalledTimes(4)
    expect(mocks.searchBrandMaps.mock.calls[0]?.[1]).toMatchObject({
      config: { phase: 'locations', queryKind: 'broad' },
    })
    expect(
      mocks.searchBrandMaps.mock.calls
        .slice(1)
        .every((call: unknown[]) => (call[1] as { config?: { queryKind?: string } }).config?.queryKind === 'fallback'),
    ).toBe(true)
  })

  it('verifies an official Maps result and keeps an uncorroborated collision private', async () => {
    mocks.searchBrandMaps
      .mockResolvedValueOnce(
        mapsResult([
          {
            title: 'Littdlework 永康旗艦店',
            address: '臺北市大安區永康街 1 號',
            latitude: 25.033,
            longitude: 121.565,
            website: 'https://littdlework.example/stores',
          },
          {
            title: 'Littdlework 其他店',
            address: '臺北市信義區碰撞路 2 號',
            latitude: 25.04,
            longitude: 121.57,
            website: 'https://unrelated.example/store',
          },
        ]),
      )
      .mockResolvedValue(mapsResult())

    const result = await runLocationsPhase(phaseOptions())
    const verified = result.candidates.find((candidate) => candidate.decision === 'verified')
    const needsReview = result.candidates.find((candidate) => candidate.decision === 'needs_review')

    expect(verified?.location).toMatchObject({
      name: 'Littdlework 永康旗艦店',
      address: '臺北市大安區永康街 1 號',
      verificationStatus: 'verified',
    })
    expect(needsReview?.location).toMatchObject({
      name: 'Littdlework 其他店',
      verificationStatus: 'needs_review',
    })
    expect(needsReview?.location.address).toBe('臺北市信義區碰撞路 2 號')
    expect(result.patch.retail_locations).toEqual([
      expect.objectContaining({
        name: 'Littdlework 永康旗艦店',
        address: '臺北市大安區永康街 1 號',
        verificationStatus: 'verified',
      }),
      expect.objectContaining({
        name: 'Littdlework 其他店',
        verificationStatus: 'needs_review',
      }),
    ])
    expect((result.patch.retail_locations as Array<Record<string, unknown>>)[1]).not.toHaveProperty('address')
  })

  it('does not verify a Maps-only collision when a fallback repeats the same place', async () => {
    const collision = {
      title: 'Littdlework 其他店',
      address: '臺北市信義區碰撞路 2 號',
      latitude: 25.04,
      longitude: 121.57,
      website: 'https://unrelated.example/store',
    }
    mocks.searchBrandMaps.mockResolvedValueOnce(mapsResult([collision])).mockResolvedValue(mapsResult([collision]))

    const result = await runLocationsPhase(phaseOptions())
    const candidate = result.candidates.find((item) => item.location.name === 'Littdlework 其他店')

    expect(candidate).toMatchObject({ decision: 'needs_review' })
    expect(result.patch.retail_locations).toEqual([
      expect.objectContaining({ name: 'Littdlework 其他店', verificationStatus: 'needs_review' }),
    ])
    expect((result.patch.retail_locations as Array<Record<string, unknown>>)[0]).not.toHaveProperty('address')
  })

  it('verifies a Maps branch when its address matches extracted description evidence', async () => {
    mocks.searchBrandMaps.mockResolvedValue(
      mapsResult([
        {
          title: 'Littdlework 永康旗艦店',
          address: '臺北市大安區永康街 1 號',
          website: 'https://unrelated.example/maps',
        },
      ]),
    )

    const result = await runLocationsPhase(
      phaseOptions({
        descriptionRewrite: descriptionRewrite({
          stockists: [
            {
              name: '永康旗艦店',
              city: 'taipei',
              type: 'independent',
              address: '臺北市大安區永康街 1 號',
            },
          ],
        }),
      }),
    )

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      decision: 'verified',
      matchReason: expect.stringContaining('corroborated'),
    })
  })

  it('verifies a complete address sourced from an official site without a Maps match', async () => {
    const result = await runLocationsPhase(
      phaseOptions({
        descriptionRewrite: descriptionRewrite({
          stockists: [
            {
              name: '永康旗艦店',
              city: 'taipei',
              type: 'independent',
              address: '臺北市大安區永康街 1 號',
            },
          ],
        }),
        scrapedData: {
          websiteUrl: 'https://littdlework.example',
          stockistPageText: '永康旗艦店：臺北市大安區永康街 1 號',
        },
      }),
    )

    expect(mocks.searchBrandMaps).toHaveBeenCalledTimes(1)
    expect(result.candidates[0]).toMatchObject({
      decision: 'verified',
      location: { address: '臺北市大安區永康街 1 號' },
    })
  })

  it('retains the SERP audit reference used for an official address', async () => {
    const result = await runLocationsPhase(
      phaseOptions({
        descriptionRewrite: descriptionRewrite({
          stockists: [
            {
              name: '永康旗艦店',
              city: 'taipei',
              type: 'independent',
              address: '臺北市大安區永康街 1 號',
              evidenceRefs: [1],
            },
          ],
        }),
        serpResult: {
          urls: ['https://littdlework.example/stores'],
          snippets: ['永康旗艦店 — 臺北市大安區永康街 1 號'],
          entries: [
            {
              title: '永康旗艦店',
              link: 'https://littdlework.example/stores',
              snippet: '永康旗艦店 — 臺北市大安區永康街 1 號',
              position: 1,
            },
          ],
          auditResultId: 'serp-audit-1',
        },
      }),
    )

    expect(result.candidates[0]).toMatchObject({
      decision: 'verified',
      auditResultIds: ['serp-audit-1'],
    })
  })

  it('does not treat an official URL alone as address evidence', async () => {
    const result = await runLocationsPhase(
      phaseOptions({
        descriptionRewrite: descriptionRewrite({
          stockists: [
            {
              name: '永康旗艦店',
              city: 'taipei',
              type: 'independent',
              address: '臺北市大安區永康街 1 號',
            },
          ],
        }),
        scrapedData: {
          websiteUrl: 'https://littdlework.example',
          stockistPageText: '品牌故事與設計理念，未提供門市地址。',
        },
      }),
    )

    expect(result.candidates[0]).toMatchObject({ decision: 'needs_review' })
    expect((result.patch.retail_locations as Array<Record<string, unknown>>)[0]).not.toHaveProperty('address')
  })
})
