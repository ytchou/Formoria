import { describe, expect, it } from 'vitest'
import { computeBrandHealth } from '../brand-health'
import { computeBrandCompleteness } from '../brand-completeness'
import type { AnalyticsResult } from '../brand-analytics'
import type { Brand } from '@/lib/types/brand'

// -- factories --

function makeBrand(overrides: Partial<Brand> = {}): Brand {
  return {
    id: 'test-id',
    name: 'Test Brand',
    slug: 'test-brand',
    description:
      'A compelling brand story that is well over two hundred characters. We make beautiful handcrafted goods from sustainable materials sourced in Taiwan. Our mission is to share Taiwanese craftsmanship with the world.',
    heroImageUrl: 'https://example.com/hero.jpg',
    status: 'approved',
    category: 'crafts',
    isVerified: false,
    isDemo: false,
    foundingYear: 2020,
    socialInstagram: 'https://ig.com/brand',
    socialThreads: 'https://threads.net/brand',
    socialFacebook: 'https://fb.com/brand',
    purchaseWebsite: 'https://shop.com',
    purchasePinkoi: null,
    purchaseShopee: null,
    otherUrls: [],
    retailLocations: [
      { name: 'Taipei Store', address: 'Taipei', latitude: 25.03, longitude: 121.56 },
      { name: 'Kaohsiung Store', address: 'Kaohsiung', latitude: 22.63, longitude: 120.27 },
    ],
    customerVoices: [],
    productPhotos: [
      'https://example.com/p1.jpg',
      'https://example.com/p2.jpg',
      'https://example.com/p3.jpg',
      'https://example.com/p4.jpg',
      'https://example.com/p5.jpg',
    ],
    siteContent: null,
    priceRange: null,
    productTags: [],
    tags: [],
    contactEmail: null,
    submittedAt: '2026-01-01T00:00:00Z',
    approvedAt: '2026-01-02T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    ...overrides,
  }
}

function makeAnalytics(overrides: Partial<AnalyticsResult> = {}): AnalyticsResult {
  return {
    totalViews: 200,
    totalClicks: 10,
    viewTrend: 'up' as const,
    clickTrend: 'flat' as const,
    ...overrides,
  } as AnalyticsResult
}

const SEVEN_DAYS_AGO = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
const TODAY = new Date()

// -- tests --

describe('computeBrandHealth', () => {
  describe('overall score', () => {
    it('returns a score between 0 and 100', () => {
      const result = computeBrandHealth(makeBrand(), makeAnalytics(), SEVEN_DAYS_AGO)
      expect(result.overall).toBeGreaterThanOrEqual(0)
      expect(result.overall).toBeLessThanOrEqual(100)
    })

    it('returns a high score for a fully-filled brand with good analytics', () => {
      const result = computeBrandHealth(makeBrand(), makeAnalytics(), SEVEN_DAYS_AGO)
      expect(result.overall).toBeGreaterThanOrEqual(70)
    })

    it('returns a low score for an empty brand with no analytics', () => {
      const emptyBrand = makeBrand({
        description: '',
        heroImageUrl: null,
        purchaseWebsite: null,
        purchasePinkoi: null,
        purchaseShopee: null,
        otherUrls: [],
        productPhotos: [],
        socialInstagram: null,
        socialThreads: null,
        socialFacebook: null,
        foundingYear: null,
        retailLocations: [],
        customerVoices: [],
      })
      const result = computeBrandHealth(emptyBrand, null, SEVEN_DAYS_AGO)
      expect(result.overall).toBeLessThanOrEqual(10)
    })

    it('rounds the overall score to an integer', () => {
      const result = computeBrandHealth(makeBrand(), makeAnalytics(), SEVEN_DAYS_AGO)
      expect(result.overall).toBe(Math.round(result.overall))
    })
  })

  describe('benchmark tiers', () => {
    it('returns "gettingStarted" for score 0-39', () => {
      const emptyBrand = makeBrand({
        description: '',
        heroImageUrl: null,
        purchaseWebsite: null,
        purchasePinkoi: null,
        purchaseShopee: null,
        otherUrls: [],
        productPhotos: [],
        socialInstagram: null,
        socialThreads: null,
        socialFacebook: null,
        foundingYear: null,
        retailLocations: [],
        customerVoices: [],
      })
      const result = computeBrandHealth(emptyBrand, null, SEVEN_DAYS_AGO)
      expect(result.tier).toBe('gettingStarted')
    })

    it('returns "growing" for score 40-69', () => {
      const partialBrand = makeBrand({
        productPhotos: ['p1.jpg'],
        socialInstagram: 'https://ig.com/x',
        socialThreads: null,
        socialFacebook: null,
        purchaseWebsite: null,
        purchasePinkoi: null,
        purchaseShopee: null,
        retailLocations: [],
        customerVoices: [],
      })
      const result = computeBrandHealth(
        partialBrand,
        makeAnalytics({ totalViews: 100, totalClicks: 2 }),
        SEVEN_DAYS_AGO,
      )
      expect(result.tier).toBe('growing')
    })

    it('returns "thriving" or "exemplary" for a fully-filled brand', () => {
      const result = computeBrandHealth(
        makeBrand(),
        makeAnalytics({ totalViews: 200, totalClicks: 10 }),
        SEVEN_DAYS_AGO,
      )
      expect(['thriving', 'exemplary']).toContain(result.tier)
    })
  })

  describe('dimensions', () => {
    it('returns exactly 7 dimensions', () => {
      const result = computeBrandHealth(makeBrand(), makeAnalytics(), SEVEN_DAYS_AGO)
      expect(result.dimensions).toHaveLength(7)
    })

    it('profileCompleteness dimension uses computeBrandCompleteness fraction', () => {
      const brand = makeBrand()
      const completeness = computeBrandCompleteness(brand)
      const result = computeBrandHealth(brand, makeAnalytics(), SEVEN_DAYS_AGO)
      const dim = result.dimensions.find((d) => d.key === 'profileCompleteness')!
      expect(dim.score).toBe(Math.round(completeness.fraction * 100))
    })

    it('photoQuality scores 0 for no photos', () => {
      const brand = makeBrand({ productPhotos: [] })
      const result = computeBrandHealth(brand, makeAnalytics(), SEVEN_DAYS_AGO)
      const dim = result.dimensions.find((d) => d.key === 'photoQuality')!
      expect(dim.score).toBe(0)
    })

    it('photoQuality scores 100 for 3+ photos', () => {
      const result = computeBrandHealth(makeBrand(), makeAnalytics(), SEVEN_DAYS_AGO)
      const dim = result.dimensions.find((d) => d.key === 'photoQuality')!
      expect(dim.score).toBe(100)
    })

    it('socialPresence scores based on count of filled social links', () => {
      const brand = makeBrand({
        socialInstagram: 'https://ig.com/x',
        socialThreads: null,
        socialFacebook: null,
      })
      const result = computeBrandHealth(brand, makeAnalytics(), SEVEN_DAYS_AGO)
      const dim = result.dimensions.find((d) => d.key === 'socialPresence')!
      expect(dim.score).toBe(50)
    })

    it('purchaseAccessibility scores 100 when purchase links exist', () => {
      const result = computeBrandHealth(makeBrand(), makeAnalytics(), SEVEN_DAYS_AGO)
      const dim = result.dimensions.find((d) => d.key === 'purchaseAccessibility')!
      expect(dim.score).toBe(100)
    })

    it('purchaseAccessibility scores 0 when no purchase links', () => {
      const brand = makeBrand({
        purchaseWebsite: null,
        purchasePinkoi: null,
        purchaseShopee: null,
        otherUrls: [],
      })
      const result = computeBrandHealth(brand, makeAnalytics(), SEVEN_DAYS_AGO)
      const dim = result.dimensions.find((d) => d.key === 'purchaseAccessibility')!
      expect(dim.score).toBe(0)
    })
  })

  describe('cold start', () => {
    it('marks engagementHealth as cold start when brand created <7 days ago', () => {
      const result = computeBrandHealth(makeBrand(), makeAnalytics(), TODAY)
      const dim = result.dimensions.find((d) => d.key === 'engagementHealth')!
      expect(dim.coldStart).toBe(true)
    })

    it('marks clickThroughRate as cold start when brand created <7 days ago', () => {
      const result = computeBrandHealth(makeBrand(), makeAnalytics(), TODAY)
      const dim = result.dimensions.find((d) => d.key === 'clickThroughRate')!
      expect(dim.coldStart).toBe(true)
    })

    it('does not mark analytics dimensions as cold start for older brands', () => {
      const result = computeBrandHealth(makeBrand(), makeAnalytics(), SEVEN_DAYS_AGO)
      const engagement = result.dimensions.find((d) => d.key === 'engagementHealth')!
      const ctr = result.dimensions.find((d) => d.key === 'clickThroughRate')!
      expect(engagement.coldStart).toBe(false)
      expect(ctr.coldStart).toBe(false)
    })

    it('cold-start dimensions contribute 0 to overall score', () => {
      const brandNew = computeBrandHealth(makeBrand(), makeAnalytics(), TODAY)
      const brandOld = computeBrandHealth(makeBrand(), makeAnalytics(), SEVEN_DAYS_AGO)
      expect(brandNew.overall).toBeLessThan(brandOld.overall)
    })

    it('marks analytics dimensions as cold start when analytics is null', () => {
      const result = computeBrandHealth(makeBrand(), null, SEVEN_DAYS_AGO)
      const engagement = result.dimensions.find((d) => d.key === 'engagementHealth')!
      const ctr = result.dimensions.find((d) => d.key === 'clickThroughRate')!
      expect(engagement.coldStart).toBe(true)
      expect(ctr.coldStart).toBe(true)
    })
  })

  describe('nudges', () => {
    it('generates nudges for incomplete dimensions', () => {
      const brand = makeBrand({
        productPhotos: [],
        socialInstagram: null,
        socialThreads: null,
        socialFacebook: null,
      })
      const result = computeBrandHealth(brand, makeAnalytics(), SEVEN_DAYS_AGO)
      expect(result.topActions.length).toBeGreaterThan(0)
    })

    it('ranks nudges by point impact descending', () => {
      const brand = makeBrand({
        productPhotos: [],
        socialInstagram: null,
        socialThreads: null,
        socialFacebook: null,
      })
      const result = computeBrandHealth(brand, makeAnalytics(), SEVEN_DAYS_AGO)
      for (let i = 1; i < result.topActions.length; i++) {
        expect(result.topActions[i - 1].points).toBeGreaterThanOrEqual(
          result.topActions[i].points,
        )
      }
    })

    it('returns at most 3 nudges', () => {
      const emptyBrand = makeBrand({
        description: '',
        heroImageUrl: null,
        purchaseWebsite: null,
        purchasePinkoi: null,
        purchaseShopee: null,
        otherUrls: [],
        productPhotos: [],
        socialInstagram: null,
        socialThreads: null,
        socialFacebook: null,
      })
      const result = computeBrandHealth(emptyBrand, null, SEVEN_DAYS_AGO)
      expect(result.topActions.length).toBeLessThanOrEqual(3)
    })

    it('returns empty nudges when all dimensions are maxed', () => {
      const result = computeBrandHealth(
        makeBrand(),
        makeAnalytics({ totalViews: 200, totalClicks: 10 }),
        SEVEN_DAYS_AGO,
      )
      expect(result.topActions.length).toBeLessThanOrEqual(3)
    })

    it('each nudge includes an anchor for the edit page', () => {
      const brand = makeBrand({ productPhotos: [] })
      const result = computeBrandHealth(brand, makeAnalytics(), SEVEN_DAYS_AGO)
      for (const nudge of result.topActions) {
        expect(nudge.anchor).toBeTruthy()
      }
    })
  })
})
