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
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockSubmitBrandForReview: vi.fn(),
  mockVerifyTurnstileToken: vi.fn(),
  mockOwnerRateLimiterCheck: vi.fn().mockReturnValue({ allowed: true }),
  mockGuestRateLimiterCheck: vi.fn().mockReturnValue({ allowed: true }),
  mockGetUserBrand: vi.fn(),
  mockCheckBrandDuplicates: vi.fn().mockResolvedValue({ nameMatches: [] }),
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
  setRequestLocale: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(
    async () =>
      new Headers([
        ['cf-connecting-ip', '127.0.0.1'],
        ['x-forwarded-for', '127.0.0.1'],
      ]),
  ),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
    }),
  ),
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
})
