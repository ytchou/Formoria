import { describe, it, expect, vi, beforeEach } from 'vitest'
import zhMessages from '../../../../../messages/zh-TW.json'

const {
  mockGetUser,
  mockSubmitBrandForReview,
  mockVerifyTurnstileToken,
  mockOwnerRateLimiterCheck,
  mockGuestRateLimiterCheck,
  mockGetUserBrand,
  mockCheckBrandDuplicates,
  mockEnrollInMarketingEmails,
  mockServiceClient,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockSubmitBrandForReview: vi.fn(),
  mockVerifyTurnstileToken: vi.fn(),
  mockOwnerRateLimiterCheck: vi.fn().mockReturnValue({ allowed: true }),
  mockGuestRateLimiterCheck: vi.fn().mockReturnValue({ allowed: true }),
  mockGetUserBrand: vi.fn(),
  mockCheckBrandDuplicates: vi.fn().mockResolvedValue({ nameMatches: [] }),
  mockEnrollInMarketingEmails: vi.fn().mockResolvedValue({
    newsletter: 'skipped',
    lifecycle: 'skipped',
  }),
  mockServiceClient: {},
}))

function makeT(messages: Record<string, unknown>, namespace: string) {
  return (key: string) => {
    const parts = `${namespace}.${key}`.split('.')
    let current: unknown = messages
    for (const part of parts) {
      if (typeof current !== 'object' || current === null) return key
      current = (current as Record<string, unknown>)[part]
    }
    return typeof current === 'string' ? current : key
  }
}

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(),
  getLocale: vi.fn().mockResolvedValue('zh-TW'),
  setRequestLocale: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(
    async () =>
      new Headers([
        ['cf-connecting-ip', '127.0.0.1'],
        ['x-forwarded-for', '127.0.0.1'],
        ['host', 'localhost:3000'],
      ]),
  ),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
    }),
  ),
  createServiceClient: vi.fn(() => mockServiceClient),
}))

vi.mock('@/lib/services/marketing-email-consent', () => ({
  enrollInMarketingEmails: mockEnrollInMarketingEmails,
}))

vi.mock('@/lib/services/submission-pipeline', () => ({
  submitBrandForReview: mockSubmitBrandForReview,
}))

vi.mock('@/lib/services/brand-owners', () => ({
  getUserBrand: mockGetUserBrand,
}))

vi.mock('@/lib/security/turnstile', () => ({
  verifyTurnstileToken: mockVerifyTurnstileToken,
}))

vi.mock('@/lib/security/rate-limiter', () => ({
  createInMemoryRateLimiter: vi.fn(() => ({
    check: vi.fn((key: string) =>
      key === '127.0.0.1'
        ? mockGuestRateLimiterCheck(key)
        : mockOwnerRateLimiterCheck(key),
    ),
  })),
}))

vi.mock('@/lib/services/brand-cleanup', () => ({
  cleanBrandName: vi.fn((name: string) => ({
    cleanedName: name,
    changed: false,
    confidence: 'high',
    patternsMatched: [],
  })),
}))

vi.mock('@/lib/services/submissions', () => ({
  buildGuestSubmissionEmail: vi.fn(() => 'guest+123@guest.formoria.invalid'),
  checkBrandDuplicates: mockCheckBrandDuplicates,
}))

import { getTranslations } from 'next-intl/server'
import {
  inspectRecommendationName,
  submitOwnerBrand,
  submitRecommendation,
} from '@/app/[locale]/submit/actions'

describe('submit actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getTranslations).mockImplementation(
      async (namespace) =>
        makeT(
          zhMessages as Record<string, unknown>,
          typeof namespace === 'string' ? namespace : '',
        ) as Awaited<ReturnType<typeof getTranslations>>,
    )
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-123',
          email: 'owner@example.com',
          user_metadata: { full_name: 'Owner User' },
        },
      },
      error: null,
    })
    mockVerifyTurnstileToken.mockResolvedValue({ success: true })
    mockGetUserBrand.mockResolvedValue(null)
    mockSubmitBrandForReview.mockResolvedValue({
      submissionId: 'submission-123',
    })
    mockCheckBrandDuplicates.mockResolvedValue({ nameMatches: [] })
    mockOwnerRateLimiterCheck.mockReturnValue({ allowed: true })
    mockGuestRateLimiterCheck.mockReturnValue({ allowed: true })
  })

  it('reports duplicate recommendation names before submission', async () => {
    mockCheckBrandDuplicates.mockResolvedValue({
      nameMatches: [
        { id: 'b1', name: 'Test Brand', slug: 'test-brand', similarity: 0.95 },
      ],
    })

    const result = await inspectRecommendationName('Test Brand')

    expect(result.hasDuplicate).toBe(true)
    expect(mockCheckBrandDuplicates).toHaveBeenCalledWith('Test Brand')
  })

  it('submits a guest recommendation with source attribution', async () => {
    const result = await submitRecommendation({
      name: 'Test Brand',
      website: 'https://test.com',
      description: 'A short recommendation note.',
      guestEmail: '',
      sourceAttribution: 'found_online',
      pdpaConsent: true,
      turnstileToken: 'test-token',
      honeypot: '',
    })

    expect(result).toBeUndefined()
    expect(mockSubmitBrandForReview).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'recommend',
        isBrandOwner: false,
        sourceAttribution: 'found_online',
        submitterEmail: 'guest+123@guest.formoria.invalid',
      }),
      { useServiceRole: true },
    )
    expect(mockVerifyTurnstileToken).toHaveBeenCalledWith(
      'test-token',
      '127.0.0.1',
      'localhost:3000',
    )
  })

  it('normalizes recommendation names and websites before submission', async () => {
    await submitRecommendation({
      name: '  Test Brand  ',
      website: '  https://test.com/store  ',
      sourceAttribution: 'found_online',
      pdpaConsent: true,
      turnstileToken: 'test-token',
      honeypot: '',
    })

    expect(mockCheckBrandDuplicates).toHaveBeenCalledWith('Test Brand')
    expect(mockSubmitBrandForReview).toHaveBeenCalledWith(
      expect.objectContaining({
        brandName: 'Test Brand',
        websiteUrl: 'https://test.com/store',
      }),
      { useServiceRole: true },
    )
  })

  it('silently ignores recommendations caught by the honeypot', async () => {
    const result = await submitRecommendation({
      name: 'Test Brand',
      website: 'https://test.com',
      sourceAttribution: 'found_online',
      pdpaConsent: true,
      turnstileToken: 'test-token',
      honeypot: 'bot-filled-this',
    })

    expect(result).toBeUndefined()
    expect(mockVerifyTurnstileToken).not.toHaveBeenCalled()
    expect(mockCheckBrandDuplicates).not.toHaveBeenCalled()
    expect(mockSubmitBrandForReview).not.toHaveBeenCalled()
  })

  it('rejects recommendations when server-side Turnstile verification fails', async () => {
    mockVerifyTurnstileToken.mockResolvedValue({ success: false })

    const result = await submitRecommendation({
      name: 'Test Brand',
      website: 'https://test.com',
      sourceAttribution: 'found_online',
      pdpaConsent: true,
      turnstileToken: 'invalid-token',
      honeypot: '',
    })

    expect(result).toEqual({ error: expect.any(String) })
    expect(mockCheckBrandDuplicates).not.toHaveBeenCalled()
    expect(mockSubmitBrandForReview).not.toHaveBeenCalled()
  })

  it('enrolls an opted-in guest after the recommendation succeeds', async () => {
    await submitRecommendation({
      name: 'Test Brand',
      website: 'https://test.com',
      guestEmail: 'reader@example.com',
      sourceAttribution: 'found_online',
      pdpaConsent: true,
      marketingEmailOptIn: true,
      turnstileToken: 'test-token',
      honeypot: '',
    })

    expect(mockSubmitBrandForReview).toHaveBeenCalledOnce()
    expect(mockEnrollInMarketingEmails).toHaveBeenCalledWith(
      mockServiceClient,
      {
        email: 'reader@example.com',
        locale: 'zh-TW',
        source: 'guest_recommendation',
        newsletter: true,
        lifecycle: false,
      },
    )
  })

  it('blocks duplicate guest recommendations', async () => {
    mockCheckBrandDuplicates.mockResolvedValue({
      nameMatches: [
        { id: 'b1', name: 'Test Brand', slug: 'test-brand', similarity: 0.95 },
      ],
    })

    const result = await submitRecommendation({
      name: 'Test Brand',
      website: 'https://test.com',
      sourceAttribution: 'found_online',
      pdpaConsent: true,
      turnstileToken: 'test-token',
      honeypot: '',
    })

    expect(result).toEqual({ error: expect.any(String) })
    expect(mockSubmitBrandForReview).not.toHaveBeenCalled()
  })

  it('returns error when guest recommendation is rate limited', async () => {
    mockGuestRateLimiterCheck.mockReturnValue({ allowed: false })

    const result = await submitRecommendation({
      name: 'Test Brand',
      website: 'https://test.com',
      sourceAttribution: 'found_online',
      pdpaConsent: true,
      turnstileToken: 'test-token',
      honeypot: '',
    })

    expect(result).toEqual({ error: expect.any(String) })
    expect(mockSubmitBrandForReview).not.toHaveBeenCalled()
  })

  it('submits an authenticated owner brand', async () => {
    const result = await submitOwnerBrand({
      name: 'Owner Brand',
      website: 'https://owner.test',
      description: 'Owner submission',
      heroImageUrl: 'https://owner.test/hero.jpg',
      mitSmileCert: '0123',
      socialLinks: { instagram: 'https://instagram.com/ownerbrand' },
      pdpaConsent: true,
      turnstileToken: 'test-token',
      honeypot: '',
    })

    expect(result).toBeUndefined()
    expect(mockSubmitBrandForReview).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'owner_claim',
        isBrandOwner: true,
        submitterEmail: 'owner@example.com',
        mitSmileCert: '0123',
      }),
    )
    expect(mockVerifyTurnstileToken).toHaveBeenCalledWith(
      'test-token',
      undefined,
      'localhost:3000',
    )
  })

  it('downgrades an additional owner submission to a community listing', async () => {
    mockGetUserBrand.mockResolvedValue({ brandId: 'owned-brand' })

    const result = await submitOwnerBrand({
      name: 'Second Brand',
      website: 'https://second.test',
      description: 'Second owner submission',
      heroImageUrl: 'https://second.test/hero.jpg',
      pdpaConsent: true,
      turnstileToken: 'test-token',
      honeypot: '',
    })

    expect(result).toEqual({ ownershipAdjusted: true })
    expect(mockSubmitBrandForReview).toHaveBeenCalledWith(
      expect.objectContaining({ isBrandOwner: false, intent: 'recommend' }),
    )
  })

  describe('submitOwnerQuick', () => {
    beforeEach(() => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: 'user-1', email: 'owner@test.com', user_metadata: { full_name: 'Owner' } } },
      })
      mockVerifyTurnstileToken.mockResolvedValue({ success: true })
      mockSubmitBrandForReview.mockResolvedValue({ submissionId: 'sub-1' })
      mockGetUserBrand.mockResolvedValue(null)
    })

    it('creates submission with owner_claim intent and no ownerData', async () => {
      const { submitOwnerQuick } = await import('../actions')
      await submitOwnerQuick({
        name: 'Quick Brand',
        website: 'https://quick.tw',
        description: 'A quick submission',
        pdpaConsent: true,
        turnstileToken: 'token-123',
        honeypot: '',
      })
      expect(mockSubmitBrandForReview).toHaveBeenCalledWith(
        expect.objectContaining({
          brandName: 'Quick Brand',
          websiteUrl: 'https://quick.tw',
          description: 'A quick submission',
          intent: 'owner_claim',
          isBrandOwner: true,
        }),
      )
      expect(mockSubmitBrandForReview.mock.calls[0][0].ownerData).toBeUndefined()
    })

    it('enrolls an opted-in owner after a quick submission succeeds', async () => {
      const { submitOwnerQuick } = await import('../actions')
      await submitOwnerQuick({
        name: 'Quick Brand',
        website: 'https://quick.tw',
        description: 'A quick submission',
        pdpaConsent: true,
        marketingEmailOptIn: true,
        turnstileToken: 'token-123',
        honeypot: '',
      })

      expect(mockEnrollInMarketingEmails).toHaveBeenCalledWith(
        mockServiceClient,
        expect.objectContaining({
          email: 'owner@test.com',
          userId: 'user-1',
          source: 'owner_quick_submission',
          newsletter: true,
          lifecycle: true,
        }),
      )
    })
  })

  describe('submitOwnerDetailedBrand', () => {
    beforeEach(() => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: 'user-1', email: 'owner@test.com', user_metadata: { full_name: 'Owner' } } },
      })
      mockVerifyTurnstileToken.mockResolvedValue({ success: true })
      mockSubmitBrandForReview.mockResolvedValue({ submissionId: 'sub-1' })
      mockGetUserBrand.mockResolvedValue(null)
    })

    it('creates submission with ownerData from wizard fields', async () => {
      const { submitOwnerDetailedBrand } = await import('../actions')
      await submitOwnerDetailedBrand({
        name: 'Detailed Brand',
        website: 'https://detailed.tw',
        description: 'Full wizard submission',
        heroImageUrl: 'https://storage.example.com/hero.webp',
        productType: 'fashion',
        foundingYear: 2020,
        productTags: ['sustainable'],
        city: 'taipei',
        priceRange: 2,
        productPhotos: [],
        socialInstagram: 'https://instagram.com/detailed',
        socialThreads: '',
        socialFacebook: '',
        purchaseWebsite: 'https://detailed.tw/shop',
        purchasePinkoi: '',
        purchaseShopee: '',
        otherUrls: [
          {
            label: 'Retail partner',
            url: 'https://retailer.example.com/detailed',
          },
        ],
        retailLocations: [],
        pdpaConsent: true,
        turnstileToken: 'token-456',
        honeypot: '',
      })
      expect(mockSubmitBrandForReview).toHaveBeenCalledWith(
        expect.objectContaining({
          brandName: 'Detailed Brand',
          intent: 'owner_claim',
          isBrandOwner: true,
          purchaseWebsite: 'https://detailed.tw/shop',
          otherUrls: [
            {
              label: 'Retail partner',
              url: 'https://retailer.example.com/detailed',
            },
          ],
          ownerData: expect.objectContaining({
            productType: 'fashion',
            foundingYear: 2020,
            city: 'taipei',
            priceRange: 2,
          }),
        }),
      )
    })

    it('enrolls an opted-in owner after a detailed submission succeeds', async () => {
      const { submitOwnerDetailedBrand } = await import('../actions')
      await submitOwnerDetailedBrand({
        name: 'Detailed Brand',
        website: 'https://detailed.tw',
        description: 'Full wizard submission',
        productType: 'fashion',
        productTags: [],
        productPhotos: [],
        socialInstagram: '',
        socialThreads: '',
        socialFacebook: '',
        purchaseWebsite: '',
        purchasePinkoi: '',
        purchaseShopee: '',
        otherUrls: [],
        retailLocations: [],
        pdpaConsent: true,
        marketingEmailOptIn: true,
        turnstileToken: 'token-456',
        honeypot: '',
      })

      expect(mockEnrollInMarketingEmails).toHaveBeenCalledWith(
        mockServiceClient,
        expect.objectContaining({
          email: 'owner@test.com',
          userId: 'user-1',
          source: 'owner_detailed_submission',
          newsletter: true,
          lifecycle: true,
        }),
      )
    })
  })
})
