import { describe, expect, it } from 'vitest'
import {
  computeQualityMetrics,
  countDescriptionValidationRetries,
  firstActiveImagesByBrand,
  type QualityMetrics,
} from '../brand-quality'

describe('QualityMetrics type', () => {
  it('has the expected shape', () => {
    const metrics: QualityMetrics = {
      totalBrands: 100,
      heroImage: { withCount: 60, withoutCount: 40, percentage: 60 },
      links: {
        socialInstagram: { count: 50, percentage: 50 },
        socialThreads: { count: 20, percentage: 20 },
        socialFacebook: { count: 30, percentage: 30 },
        purchaseWebsite: { count: 70, percentage: 70 },
        purchasePinkoi: { count: 40, percentage: 40 },
        purchaseShopee: { count: 35, percentage: 35 },
      },
      description: {
        withCount: 80, withoutCount: 20, percentage: 80, avgLength: 145,
      },
      completeness: { excellent: 10, good: 30, fair: 40, poor: 20 },
      enrichment: {
        languagePurityPct: 90,
        heroClassifiedPct: 85,
        promoHeroCount: 2,
        validationFailures: 3,
        descriptionCoveragePct: 80,
        descriptionEnCoveragePct: 70,
      },
    }
    expect(metrics.totalBrands).toBe(100)
    expect(metrics.heroImage.percentage).toBe(60)
    expect(metrics.links.socialInstagram.count).toBe(50)
    expect(metrics.description.avgLength).toBe(145)
    expect(metrics.completeness.excellent).toBe(10)
  })
})

describe('computeQualityMetrics', () => {
  it('computes quality metrics: purity %, hero-classified %, promo-hero count, validation failures', () => {
    const m = computeQualityMetrics({
      brands: [{ description: '純中文描述'.repeat(20), descriptionEn: null }],
      // `promo` is a LEGACY tag and only pre-contract rows carry it, but a
      // promo hero is still the defect this metric exists to count.
      images: [{ role: 'hero', tag: 'promo' }, { role: 'hero', tag: 'product' }],
      aiRejections: 3,
    } as never)
    expect(m.promoHeroCount).toBe(1)
    expect(m.heroClassifiedPct).toBe(100)
    expect(m.validationFailures).toBe(3)
  })

  it('does not count a logo hero as a promo hero', () => {
    // Hero ordering is a pure quality sort, so a brand-identity image winning
    // slot 0 is a legitimate outcome — it used to be flagged as a defect.
    const m = computeQualityMetrics({
      brands: [{ description: '純中文描述'.repeat(20), descriptionEn: null }],
      images: [{ role: 'hero', tag: 'logo' }, { role: 'hero', tag: 'product' }],
      aiRejections: 0,
    } as never)
    expect(m.promoHeroCount).toBe(0)
    expect(m.heroClassifiedPct).toBe(100)
  })
})

describe('firstActiveImagesByBrand', () => {
  it('selects each brand first ordered image even when no image occupies slot zero', () => {
    expect(
      firstActiveImagesByBrand([
        { brand_id: 'maria-ceramics', sort_order: 4, tags: ['lifestyle'] },
        { brand_id: 'maria-ceramics', sort_order: 2, tags: ['product'] },
        { brand_id: 'woven-studio', sort_order: 7, tags: ['promo'] },
      ]),
    ).toEqual([
      { brand_id: 'maria-ceramics', sort_order: 2, tags: ['product'] },
      { brand_id: 'woven-studio', sort_order: 7, tags: ['promo'] },
    ])
  })
})

describe('countDescriptionValidationRetries', () => {
  it('counts hook rows for retry attempts and ignores domain rows without raw responses', () => {
    expect(
      countDescriptionValidationRetries([
        { attempt: 1, raw_response: { response: { choices: [] }, usage: { total_tokens: 120 } } },
        { attempt: 2, raw_response: { response: { choices: [] }, usage: { total_tokens: 80 } } },
        { attempt: 3, raw_response: { response: { choices: [] }, usage: { total_tokens: 60 } } },
        { attempt: null, raw_response: null },
      ]),
    ).toBe(2)
  })
})
