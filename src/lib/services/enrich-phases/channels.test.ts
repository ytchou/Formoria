import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChannelCandidate } from '@/lib/types/brand-channel'
import type { DescriptionRewriteResult } from '../description-rewrite'
import type { ChannelsPhaseOptions } from './channels'
import type { BrandMapsSearchResult } from './scraper/serper'
import { runChannelsPhase } from './channels'

const mocks = vi.hoisted(() => ({
  searchBrandMaps: vi.fn(),
  upsertEnrichedChannels: vi.fn(),
}))

vi.mock('./scraper/serper', () => ({ searchBrandMaps: mocks.searchBrandMaps }))
vi.mock('@/lib/services/brand-channels', () => ({
  upsertEnrichedChannels: mocks.upsertEnrichedChannels,
}))

function mapsResult(
  places: BrandMapsSearchResult['places'] = [],
): BrandMapsSearchResult {
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

function descriptionRewrite(
  overrides: Partial<DescriptionRewriteResult> = {},
): DescriptionRewriteResult {
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

function phaseOptions(
  overrides: Partial<ChannelsPhaseOptions> = {},
): ChannelsPhaseOptions {
  return {
    brand: {
      id: 'submission-1',
      slug: 'submission-1',
      name: 'Littdlework',
      city: 'taipei',
      purchase_website: 'https://littdlework.example',
    },
    phases: ['locations'],
    dryRun: true,
    target: { type: 'submission', id: 'submission-1' },
    supabase: {} as never,
    ...overrides,
  }
}

function auditSupabase(channelRows: Array<{ id: string; normalized_name: string }> = []) {
  const insert = vi.fn().mockResolvedValue({ error: null })
  const from = vi.fn((table: string) => {
    if (table === 'brand_location_candidates') return { insert }
    if (table === 'brand_channels') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: channelRows, error: null }),
          })),
        })),
      }
    }
    throw new Error(`Unexpected table: ${table}`)
  })
  return { from, insert }
}

describe('channels enrichment phase', () => {
  beforeEach(() => {
    mocks.searchBrandMaps.mockReset()
    mocks.upsertEnrichedChannels.mockReset()
    mocks.searchBrandMaps.mockResolvedValue(mapsResult())
    mocks.upsertEnrichedChannels.mockResolvedValue({ ok: true, count: 1 })
  })

  it('collapses a merchant with multiple addresses into one nationwide chain channel', async () => {
    mocks.searchBrandMaps
      .mockResolvedValueOnce(mapsResult())
      .mockResolvedValueOnce(
        mapsResult([
          {
            title: 'ROCKLAND 台北忠孝店',
            address: '臺北市大安區忠孝東路四段 1 號',
          },
          {
            title: 'ROCKLAND 新竹巨城店',
            address: '新竹市東區中央路 229 號',
          },
        ]),
      )

    const result = await runChannelsPhase(
      phaseOptions({
        descriptionRewrite: descriptionRewrite({
          stockists: [
            { name: 'ROCKLAND', city: 'taipei', type: 'independent' },
          ],
        }),
      }),
    )

    expect(result.candidates).toEqual([
      expect.objectContaining<Partial<ChannelCandidate>>({
        name: 'ROCKLAND',
        normalizedName: 'rockland',
        channelType: 'offline',
        address: null,
        regionLabel: '全台多間門市',
      }),
    ])
    expect(result.patch.channels).toEqual(result.candidates)
  })

  it('keeps the address and mapped city region for one corroborated place', async () => {
    mocks.searchBrandMaps.mockResolvedValueOnce(
      mapsResult([
        {
          title: '永康旗艦店',
          address: '臺北市大安區永康街 1 號',
          latitude: 25.033,
          longitude: 121.565,
          website: 'https://littdlework.example/stores',
        },
      ]),
    )

    const result = await runChannelsPhase(
      phaseOptions({
        descriptionRewrite: descriptionRewrite({
          stockists: [
            { name: '永康旗艦店', city: 'taipei', type: 'independent' },
          ],
        }),
      }),
    )

    expect(result.candidates).toEqual([
      expect.objectContaining<Partial<ChannelCandidate>>({
        name: '永康旗艦店',
        normalizedName: '永康',
        address: '臺北市大安區永康街 1 號',
        regionLabel: '台北',
      }),
    ])
  })

  it('carries a noise-stripped normalized name for a branch-suffixed Maps title', async () => {
    mocks.searchBrandMaps.mockResolvedValueOnce(
      mapsResult([
        {
          title: '鄉野情戶外用品店',
          address: '臺中市南屯區五權西路二段 316 號',
          website: 'https://camping-life.example/stores',
        },
      ]),
    )

    const result = await runChannelsPhase(
      phaseOptions({
        brand: {
          ...phaseOptions().brand,
          name: '鄉野情',
          purchase_website: 'https://camping-life.example',
        },
      }),
    )

    expect(result.candidates[0]).toMatchObject({
      name: '鄉野情戶外用品店',
      normalizedName: '鄉野情',
    })
  })

  it('upserts brand-target channels and records the resolved channel id in the audit row', async () => {
    const supabase = auditSupabase([{ id: 'channel-1', normalized_name: '永康' }])
    mocks.searchBrandMaps.mockResolvedValueOnce(
      mapsResult([
        {
          title: '永康旗艦店',
          address: '臺北市大安區永康街 1 號',
          website: 'https://littdlework.example/stores',
        },
      ]),
    )

    const result = await runChannelsPhase(
      phaseOptions({
        brand: { ...phaseOptions().brand, id: 'brand-1', slug: 'brand-1' },
        dryRun: false,
        target: { type: 'brand', id: 'brand-1' },
        supabase: { from: supabase.from } as never,
        descriptionRewrite: descriptionRewrite({
          stockists: [{ name: '永康旗艦店', city: 'taipei', type: 'independent' }],
        }),
      }),
    )

    expect(mocks.upsertEnrichedChannels).toHaveBeenCalledWith(
      'brand-1',
      result.candidates,
    )
    expect(supabase.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        brand_id: 'brand-1',
        submission_id: null,
        channel_id: 'channel-1',
      }),
    ])
  })

  it('stages submission-target channels in enriched data without writing brand channels before approval', async () => {
    const supabase = auditSupabase()
    mocks.searchBrandMaps.mockResolvedValueOnce(
      mapsResult([
        {
          title: '永康旗艦店',
          address: '臺北市大安區永康街 1 號',
          website: 'https://littdlework.example/stores',
        },
      ]),
    )

    const result = await runChannelsPhase(
      phaseOptions({
        dryRun: false,
        supabase: { from: supabase.from } as never,
        descriptionRewrite: descriptionRewrite({
          stockists: [{ name: '永康旗艦店', city: 'taipei', type: 'independent' }],
        }),
      }),
    )

    expect(result.patch).toEqual({ channels: result.candidates })
    expect(mocks.upsertEnrichedChannels).not.toHaveBeenCalled()
    expect(supabase.from).not.toHaveBeenCalledWith('brand_channels')
  })
})
