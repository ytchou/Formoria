import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isPhysicalRetailLocation,
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
    const baseCandidate = candidate()
    if (!isPhysicalRetailLocation(baseCandidate.location)) throw new Error('Expected a physical test candidate')
    const incoming = candidate({
      location: {
        ...baseCandidate.location,
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

  it('publishes needs-review addresses as unconfirmed public locations', () => {
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

    expect(location && isPublicRetailLocation(location)).toBe(true)
    expect(location && isPublicMappableRetailLocation(location)).toBe(false)
  })

  it('retains a weak candidate address while leaving owner confirmation unset', () => {
    const merged = mergeLocationCandidates([], [candidate({ decision: 'needs_review' })])
    const location = merged.at(0)

    expect(location).toMatchObject({
      name: '永康旗艦店',
      address: '臺北市大安區永康街 1 號',
      latitude: 25.033,
      longitude: 121.565,
      verificationStatus: 'needs_review',
      confirmationStatus: 'unconfirmed',
    })
  })

  it('removes an unconfirmed physical placeholder when the same chain already exists', () => {
    const merged = mergeLocationCandidates(
      [
        {
          kind: 'location',
          name: 'C2H3',
          relationshipType: 'stockist',
          verificationStatus: 'manual',
          confirmationStatus: 'unconfirmed',
        },
        { kind: 'retail_chain', name: 'C2H3' },
      ],
      [
        {
          location: { kind: 'retail_chain', name: 'C2H3', retailerUrl: 'https://c2h3.example/stores' },
          decision: 'verified',
          normalizedAddress: null,
          normalizedIdentity: 'retail_chain|c2h3',
          matchReason: 'multiple branches',
          evidence: [],
          auditResultIds: [],
          origin: 'existing',
          lookupAttempted: true,
        },
      ],
    )

    expect(merged).toEqual([
      { kind: 'retail_chain', name: 'C2H3', retailerUrl: 'https://c2h3.example/stores' },
    ])
  })

  it('does not reintroduce an addressless physical placeholder after its chain candidate', () => {
    const chain: LocationCandidate = {
      location: { kind: 'retail_chain', name: 'C2H3' },
      decision: 'verified',
      normalizedAddress: null,
      normalizedIdentity: 'retail_chain|c2h3',
      matchReason: 'multiple branches',
      evidence: [],
      auditResultIds: [],
      origin: 'existing',
      lookupAttempted: true,
    }
    const placeholder: LocationCandidate = {
      location: {
        kind: 'location',
        name: 'C2H3',
        relationshipType: 'stockist',
        verificationStatus: 'needs_review',
        confirmationStatus: 'unconfirmed',
      },
      decision: 'needs_review',
      normalizedAddress: null,
      normalizedIdentity: 'c2h3||',
      matchReason: 'no safe match',
      evidence: [],
      auditResultIds: [],
      origin: 'existing',
      lookupAttempted: true,
    }

    expect(mergeLocationCandidates([], [chain, placeholder])).toEqual([
      { kind: 'retail_chain', name: 'C2H3' },
    ])
  })

  it.each([
    ['physical first', false],
    ['chain first', true],
  ])('keeps an owner-confirmed physical row over a same-name chain (%s)', (_label, chainFirst) => {
    const physical = {
      kind: 'location' as const,
      name: 'Owner location',
      relationshipType: 'brand_store' as const,
      confirmationStatus: 'owner_confirmed' as const,
    }
    const chain = { kind: 'retail_chain' as const, name: 'Owner location' }
    const existing = chainFirst ? [chain, physical] : [physical, chain]

    expect(mergeLocationCandidates(existing, [])).toEqual([
      expect.objectContaining({
        kind: 'location',
        name: 'Owner location',
        confirmationStatus: 'owner_confirmed',
      }),
    ])
  })

  it('keeps a single addressed location instead of a stale same-name chain', () => {
    const incoming = candidate({
      origin: 'existing',
      lookupAttempted: true,
    })
    const merged = mergeLocationCandidates(
      [
        {
          kind: 'location',
          name: '永康旗艦店',
          relationshipType: 'brand_store',
          verificationStatus: 'manual',
          confirmationStatus: 'unconfirmed',
        },
        { kind: 'retail_chain', name: '永康旗艦店' },
      ],
      [incoming],
    )

    expect(merged).toEqual([
      expect.objectContaining({
        kind: 'location',
        name: '永康旗艦店',
        address: '臺北市大安區永康街 1 號',
      }),
    ])
  })
})

describe('locations phase evidence and call bounds', () => {
  beforeEach(() => {
    mocks.searchBrandMaps.mockReset()
    mocks.searchBrandMaps.mockResolvedValue(mapsResult())
  })

  it('searches every unresolved extracted stockist after the broad Maps call', async () => {
    const stockists = ['A 店', 'B 店', 'C 店', 'D 店', 'E 店'].map((name) => ({
      name,
      city: 'taipei',
      type: 'independent' as const,
    }))

    await runLocationsPhase(phaseOptions({ descriptionRewrite: descriptionRewrite({ stockists }) }))

    expect(mocks.searchBrandMaps).toHaveBeenCalledTimes(6)
    expect(mocks.searchBrandMaps.mock.calls[0]?.[1]).toMatchObject({
      config: { phase: 'locations', queryKind: 'broad' },
    })
    expect(
      mocks.searchBrandMaps.mock.calls
        .slice(1)
        .every((call: unknown[]) => (call[1] as { config?: { queryKind?: string } }).config?.queryKind === 'fallback'),
    ).toBe(true)
  })

  it('searches every stored incomplete location in one run', async () => {
    const retailLocations = ['A 店', 'B 店', 'C 店', 'D 店', 'E 店'].map((name) => ({
      kind: 'location' as const,
      name,
      relationshipType: 'stockist' as const,
      city: 'taipei',
      verificationStatus: 'manual' as const,
      confirmationStatus: 'unconfirmed' as const,
    }))

    const result = await runLocationsPhase(
      phaseOptions({
        brand: { ...phaseOptions().brand, retail_locations: retailLocations },
      }),
    )

    expect(mocks.searchBrandMaps).toHaveBeenCalledTimes(6)
    expect(mocks.searchBrandMaps.mock.calls.slice(1).map((call) => call[0])).toEqual([
      'Littdlework A 店 taipei',
      'Littdlework B 店 taipei',
      'Littdlework C 店 taipei',
      'Littdlework D 店 taipei',
      'Littdlework E 店 taipei',
    ])
    expect(result.patch.retail_locations).toEqual([
      expect.objectContaining({
        name: 'A 店',
        verificationStatus: 'needs_review',
      }),
      expect.objectContaining({
        name: 'B 店',
        verificationStatus: 'needs_review',
      }),
      expect.objectContaining({
        name: 'C 店',
        verificationStatus: 'needs_review',
      }),
      expect.objectContaining({
        name: 'D 店',
        verificationStatus: 'needs_review',
      }),
      expect.objectContaining({
        name: 'E 店',
        verificationStatus: 'needs_review',
      }),
    ])
  })

  it('persists only stored locations whose fallback lookup ran', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const from = vi.fn().mockReturnValue({ insert })
    const retailLocations = ['A 店', 'B 店', 'C 店', 'D 店', 'E 店'].map((name) => ({
      kind: 'location' as const,
      name,
      relationshipType: 'stockist' as const,
      city: 'taipei',
      verificationStatus: 'manual' as const,
      confirmationStatus: 'unconfirmed' as const,
    }))

    await runLocationsPhase(
      phaseOptions({
        brand: { ...phaseOptions().brand, retail_locations: retailLocations },
        dryRun: false,
        supabase: { from } as never,
      }),
    )

    expect(from).toHaveBeenCalledWith('brand_location_candidates')
    expect(insert).toHaveBeenCalledOnce()
    const rows = insert.mock.calls[0]?.[0] as Array<{ location: { name: string } }>
    expect(rows.map((row) => row.location.name)).toEqual(['A 店', 'B 店', 'C 店', 'D 店', 'E 店'])
  })

  it('assigns a single relevant fallback result to the stockist that was queried', async () => {
    mocks.searchBrandMaps.mockResolvedValueOnce(mapsResult()).mockResolvedValueOnce(
      mapsResult([
        {
          title: 'MTSK 手工牛皮皮鞋－新北三重總店',
          address: '新北市三重區秀江街245號',
          latitude: 25.073,
          longitude: 121.499,
        },
      ]),
    )

    const result = await runLocationsPhase(
      phaseOptions({
        brand: {
          ...phaseOptions().brand,
          name: 'MTSK',
          retail_locations: [
            {
              kind: 'location',
              name: 'MTSK 手工牛皮皮鞋－新北三重總店',
              relationshipType: 'brand_store',
              city: 'taipei',
              verificationStatus: 'manual',
              confirmationStatus: 'unconfirmed',
            },
          ],
        },
      }),
    )

    expect(result.patch.retail_locations).toEqual([
      expect.objectContaining({
        name: 'MTSK 手工牛皮皮鞋－新北三重總店',
        address: '新北市三重區秀江街245號',
        city: 'new_taipei',
        latitude: 25.073,
        longitude: 121.499,
        confirmationStatus: 'unconfirmed',
      }),
    ])
  })

  it('does not assign a single fallback result from a conflicting named city', async () => {
    mocks.searchBrandMaps.mockResolvedValueOnce(mapsResult()).mockResolvedValueOnce(
      mapsResult([
        {
          title: '欣美SingBee 台中市政門市',
          address: '臺中市南屯區文心路一段542-1號',
        },
      ]),
    )

    const result = await runLocationsPhase(
      phaseOptions({
        brand: {
          ...phaseOptions().brand,
          name: 'SingBee 欣美',
          retail_locations: [
            {
              kind: 'location',
              name: '台北服務據點',
              relationshipType: 'brand_store',
              city: 'taipei',
              verificationStatus: 'manual',
              confirmationStatus: 'unconfirmed',
            },
          ],
        },
      }),
    )

    expect(result.patch.retail_locations).toEqual([
      expect.objectContaining({ name: '台北服務據點', verificationStatus: 'needs_review' }),
    ])
    expect((result.patch.retail_locations as Array<Record<string, unknown>>)[0]?.address).toBeUndefined()
  })

  it('rejects an existing unconfirmed place that is clearly not a retail location', async () => {
    mocks.searchBrandMaps.mockResolvedValueOnce(mapsResult()).mockResolvedValueOnce(
      mapsResult([
        {
          title: '欣美牙醫診所',
          address: '高雄市左營區博愛二路8號',
        },
      ]),
    )

    const result = await runLocationsPhase(
      phaseOptions({
        brand: {
          ...phaseOptions().brand,
          name: 'SingBee 欣美',
          retail_locations: [
            {
              kind: 'location',
              name: '欣美牙醫診所',
              address: '高雄市左營區博愛二路8號',
              relationshipType: 'stockist',
              verificationStatus: 'needs_review',
              confirmationStatus: 'unconfirmed',
            },
          ],
        },
      }),
    )

    expect(result.candidates).toEqual([
      expect.objectContaining({ decision: 'rejected', lookupAttempted: true }),
    ])
    expect(result.patch.retail_locations).toEqual([])
  })

  it('matches conservative Chinese retailer-name variants', async () => {
    mocks.searchBrandMaps.mockResolvedValueOnce(
      mapsResult([
        {
          title: '鄉野情戶外休閒專業中心',
          address: '臺中市南屯區五權西路二段316號',
          latitude: 24.14,
          longitude: 120.64,
          website: 'https://camping-life.example/stores',
        },
      ]),
    )

    const result = await runLocationsPhase(
      phaseOptions({
        descriptionRewrite: descriptionRewrite({
          stockists: [
            {
              name: '鄉野情戶外用品店',
              city: 'taichung',
              type: 'independent',
            },
          ],
        }),
      }),
    )

    expect(result.patch.retail_locations).toEqual([
      expect.objectContaining({
        kind: 'location',
        name: '鄉野情戶外用品店',
        address: '臺中市南屯區五權西路二段316號',
        verificationStatus: 'needs_review',
      }),
    ])
  })

  it('does not let a shorter broad brand result consume a longer named stockist', async () => {
    mocks.searchBrandMaps
      .mockResolvedValueOnce(
        mapsResult([
          {
            title: '雲御織',
            address: '雲林縣斗六市科加路16-1號',
          },
        ]),
      )
      .mockResolvedValueOnce(mapsResult())

    const result = await runLocationsPhase(
      phaseOptions({
        brand: {
          ...phaseOptions().brand,
          name: '雲御織 YUNCLEAN',
          retail_locations: [
            {
              kind: 'location',
              name: '雲御織松菸店',
              relationshipType: 'stockist',
              city: 'taipei',
              verificationStatus: 'manual',
              confirmationStatus: 'unconfirmed',
            },
          ],
        },
      }),
    )

    expect(mocks.searchBrandMaps.mock.calls.map((call) => call[0])).toContain(
      '雲御織 YUNCLEAN 雲御織松菸店 taipei',
    )
    const target = (result.patch.retail_locations as Array<Record<string, unknown>>).find(
      (location) => location.name === '雲御織松菸店',
    )
    expect(target).toMatchObject({ name: '雲御織松菸店', verificationStatus: 'needs_review' })
    expect(target?.address).toBeUndefined()
  })

  it('classifies multiple fallback branches for a short retailer core as a chain', async () => {
    mocks.searchBrandMaps.mockResolvedValueOnce(mapsResult()).mockResolvedValueOnce(
      mapsResult([
        {
          title: '豐利(登峰)戶外用品生活館',
          address: '臺南市中西區五妃街210號',
        },
        {
          title: '豐利體育用品社',
          address: '臺南市中西區健康路一段294號',
        },
      ]),
    )

    const result = await runLocationsPhase(
      phaseOptions({
        brand: {
          ...phaseOptions().brand,
          name: 'HANCHOR',
          retail_locations: [
            {
              kind: 'location',
              name: '豐利戶外',
              relationshipType: 'stockist',
              city: 'taipei',
              verificationStatus: 'manual',
              confirmationStatus: 'unconfirmed',
            },
          ],
        },
      }),
    )

    expect(result.patch.retail_locations).toEqual([{ kind: 'retail_chain', name: '豐利戶外' }])
  })

  it('rejects weak fuzzy matches without a shared retailer identity', async () => {
    const collision = {
      title: '山一登山用品',
      address: '臺北市中正區測試路 1 號',
      latitude: 25.04,
      longitude: 121.51,
    }
    mocks.searchBrandMaps.mockResolvedValue(mapsResult([collision]))

    const result = await runLocationsPhase(
      phaseOptions({
        descriptionRewrite: descriptionRewrite({
          stockists: [
            {
              name: '山衣丁',
              city: 'taipei',
              type: 'independent',
            },
          ],
        }),
      }),
    )

    expect(result.patch.retail_locations).toEqual([expect.objectContaining({ name: '山衣丁' })])
    expect((result.patch.retail_locations as Array<Record<string, unknown>>)[0]).not.toHaveProperty('address')
  })

  it('converts an unaddressed retailer into a chain after multiple branch matches', async () => {
    mocks.searchBrandMaps.mockResolvedValueOnce(mapsResult()).mockResolvedValueOnce(
      mapsResult([
        {
          title: 'ROCKLAND 台北忠孝店',
          address: '臺北市大安區忠孝東路四段 1 號',
          website: 'https://rockland.example/stores/taipei',
        },
        {
          title: 'ROCKLAND 新竹巨城店',
          address: '新竹市東區中央路 229 號',
          website: 'https://rockland.example/stores/hsinchu',
        },
      ]),
    )

    const result = await runLocationsPhase(
      phaseOptions({
        brand: {
          ...phaseOptions().brand,
          retail_locations: [
            {
              kind: 'location',
              name: 'ROCKLAND',
              relationshipType: 'stockist',
              verificationStatus: 'manual',
              confirmationStatus: 'unconfirmed',
            },
          ],
        },
      }),
    )

    expect(result.candidates).toEqual([
      expect.objectContaining({
        decision: 'verified',
        location: {
          kind: 'retail_chain',
          name: 'ROCKLAND',
          retailerUrl: 'https://rockland.example/stores/taipei',
        },
      }),
    ])
    expect(result.patch.retail_locations).toEqual([
      {
        kind: 'retail_chain',
        name: 'ROCKLAND',
        retailerUrl: 'https://rockland.example/stores/taipei',
      },
    ])
  })

  it('matches bilingual brand aliases regardless of title word order', async () => {
    mocks.searchBrandMaps.mockResolvedValueOnce(
      mapsResult([
        {
          title: '欣美SingBee 台中市政門市',
          address: '臺中市南屯區文心路一段542-1號',
          latitude: 24.154468,
          longitude: 120.647006,
          website: 'https://buy.singbee-tw.com/',
        },
      ]),
    )

    const result = await runLocationsPhase(
      phaseOptions({
        brand: {
          ...phaseOptions().brand,
          name: 'SingBee 欣美',
          purchase_website: 'https://buy.singbee-tw.com/',
        },
      }),
    )

    expect(result.candidates).toEqual([
      expect.objectContaining({
        decision: 'verified',
        location: expect.objectContaining({
          name: '欣美SingBee 台中市政門市',
          address: '臺中市南屯區文心路一段542-1號',
          latitude: 24.154468,
          longitude: 120.647006,
        }),
      }),
    ])
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
    expect((result.patch.retail_locations as Array<Record<string, unknown>>)[1]).toHaveProperty(
      'address',
      '臺北市信義區碰撞路 2 號',
    )
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
      expect.objectContaining({
        name: 'Littdlework 其他店',
        verificationStatus: 'needs_review',
      }),
    ])
    expect((result.patch.retail_locations as Array<Record<string, unknown>>)[0]).toHaveProperty(
      'address',
      '臺北市信義區碰撞路 2 號',
    )
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
    expect((result.patch.retail_locations as Array<Record<string, unknown>>)[0]).toHaveProperty(
      'address',
      '臺北市大安區永康街 1 號',
    )
  })
})
