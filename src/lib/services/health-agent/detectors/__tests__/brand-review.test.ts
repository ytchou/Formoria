import { describe, expect, it } from 'vitest'

import {
  evaluateBrandReview,
  type RecentBrandEdit,
} from '../../../../../../scripts/health-agent/brand-review'

const NOW_ISO = '2026-07-23T12:00:00.000Z'
const WINDOW_START_ISO = '2026-07-22T12:00:00.000Z'

function brand(overrides: Partial<RecentBrandEdit> = {}): RecentBrandEdit {
  return {
    id: 'brand-1',
    name: 'Test Brand',
    description: null,
    descriptionEn: null,
    purchaseWebsite: 'https://example.com/',
    purchasePinkoi: null,
    purchaseShopee: null,
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
    otherUrls: null,
    ...overrides,
  }
}

describe('brand-review evaluate functions match the scripts implementation', () => {
  it('produces identical findings for a brand with CJK in EN field', () => {
    const result = evaluateBrandReview(
      [
        brand({
          description: 'pure english',
          descriptionEn: '這是中文描述',
        }),
      ],
      NOW_ISO,
      WINDOW_START_ISO,
    )

    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({
      severity: 'low',
      title: 'Description language may be swapped (CJK in EN field)',
      source: 'directory',
    })
    expect(result.snapshot).toEqual({
      reviewedCount: 1,
      findingCount: 1,
      windowStartIso: WINDOW_START_ISO,
      nowIso: NOW_ISO,
    })
  })

  it('flags brand with no usable visit CTA', () => {
    const result = evaluateBrandReview(
      [
        brand({
          purchaseWebsite: null,
          purchasePinkoi: null,
          purchaseShopee: null,
          socialInstagram: null,
          socialThreads: null,
          socialFacebook: null,
        }),
      ],
      NOW_ISO,
      WINDOW_START_ISO,
    )

    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({
      severity: 'medium',
      title: 'Brand has no usable visit CTA',
    })
  })

  it('returns empty findings for a healthy brand', () => {
    const result = evaluateBrandReview([brand()], NOW_ISO, WINDOW_START_ISO)
    expect(result.findings).toHaveLength(0)
  })
})
