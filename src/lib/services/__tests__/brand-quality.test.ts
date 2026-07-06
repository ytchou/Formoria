import { describe, expect, it } from 'vitest'
import { computeQualityMetrics, type QualityMetrics } from '../brand-quality'

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
      images: [{ role: 'hero', tag: 'promo' }, { role: 'hero', tag: 'product' }],
      aiRejections: 3,
    } as never)
    expect(m.promoHeroCount).toBe(1)
    expect(m.heroClassifiedPct).toBe(100)
    expect(m.validationFailures).toBe(3)
  })
})
