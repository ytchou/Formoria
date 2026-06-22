import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSubmissionSchema } from '@/lib/validations/submission'
import zhMessages from '../../../../../messages/zh-TW.json'

const {
  mockGetUser,
  mockSubmitBrandForReview,
  mockVerifyTurnstileToken,
  mockRateLimiterCheck,
} = vi.hoisted(() => {
  const mockRateLimiterCheck = vi.fn().mockReturnValue({ allowed: true })
  return {
    mockGetUser: vi.fn(),
    mockSubmitBrandForReview: vi.fn(),
    mockVerifyTurnstileToken: vi.fn(),
    mockRateLimiterCheck,
  }
})

// Resolve dot-delimited key paths in a nested messages object
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

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
    })
  ),
}))

vi.mock('@/lib/services/submission-pipeline', () => ({
  submitBrandForReview: mockSubmitBrandForReview,
}))

vi.mock('@/lib/security/turnstile', () => ({
  verifyTurnstileToken: mockVerifyTurnstileToken,
}))

vi.mock('@/lib/security/rate-limiter', () => ({
  createInMemoryRateLimiter: () => ({ check: mockRateLimiterCheck }),
}))

vi.mock('@/lib/services/brand-cleanup', () => ({
  cleanBrandName: vi.fn((name: string) => ({
    cleanedName: name,
    changed: false,
    confidence: 'high',
    patternsMatched: [],
  })),
}))

import { getTranslations } from 'next-intl/server'
import { submitBrand } from '@/app/[locale]/submit/actions'

// Test the schema selection logic in isolation — not the full action
// (Full action involves Turnstile + Supabase; those are covered by E2E)
describe('server action schema routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Wire up next-intl/server with zh-TW messages so the action resolves
    // submit.errors.* strings correctly
    vi.mocked(getTranslations).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (namespace: any) => makeT(zhMessages as Record<string, unknown>, typeof namespace === 'string' ? namespace : '') as any
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
    mockSubmitBrandForReview.mockResolvedValue({
      brand: { id: 'brand-123' },
      submissionId: 'submission-123',
    })
  })

  it('owner payload without required region field fails schema', () => {
    const schema = createSubmissionSchema(true)
    const ownerPayload = {
      name: 'Test Brand',
      website: 'https://test.com',
      // region intentionally omitted — it is required
      isOwner: true,
      purchaseLinks: [{ platform: 'shopify', url: 'https://shop.com' }],
      pdpaConsent: true,
      socialLinks: { instagram: '', threads: '', facebook: '', website: 'https://test.com' },
      turnstileToken: 'test-token',
    }
    expect(schema.safeParse(ownerPayload).success).toBe(false)
  })

  it('community payload without owner-only fields passes community schema', () => {
    const schema = createSubmissionSchema(false)
    const communityPayload = {
      name: 'Test Brand',
      website: 'https://test.com',
      region: 'taipei',
      isOwner: false,
      purchaseLinks: [],
      pdpaConsent: true,
      socialLinks: { instagram: '', threads: '', facebook: '', website: 'https://test.com' },
      sourceAttribution: 'found_online',
      turnstileToken: 'test-token',
    }
    expect(schema.safeParse(communityPayload).success).toBe(true)
  })

  it('omits the dormant brand column from the brand insert payload', async () => {
    await submitBrand({
      name: 'Test Brand',
      website: 'https://test.com',
      region: 'taipei',
      isOwner: true,
      purchaseLinks: [{ platform: 'shopify', url: 'https://shop.com' }],
      pdpaConsent: true,
      socialLinks: { instagram: '', threads: '', facebook: '', website: 'https://test.com' },
      turnstileToken: 'test-token',
      honeypot: '',
    })

    expect(mockSubmitBrandForReview).toHaveBeenCalledTimes(1)
    const payload = mockSubmitBrandForReview.mock.calls[0][0]
    expect('founder' in payload).toBe(false)
  })

  it('stores structured suggestedTags with region', async () => {
    await submitBrand({
      name: 'Test Brand',
      website: 'https://test.com',
      region: 'taipei',
      isOwner: false,
      purchaseLinks: [],
      pdpaConsent: true,
      socialLinks: { instagram: '', threads: '', facebook: '', website: '' },
      sourceAttribution: 'found_online',
      turnstileToken: 'test-token',
      honeypot: '',
    })

    expect(mockSubmitBrandForReview).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'taipei',
      })
    )
  })

  it('returns undefined on successful submission', async () => {
    const result = await submitBrand({
      name: 'Test Brand',
      website: 'https://test.com',
      region: 'taipei',
      isOwner: false,
      purchaseLinks: [{ platform: 'shopify', url: 'https://shop.com/product' }],
      pdpaConsent: true,
      socialLinks: { instagram: '', threads: '', facebook: '', website: 'https://test.com' },
      sourceAttribution: 'found_online',
      turnstileToken: 'test-token',
      honeypot: '',
    })

    expect(result).toBeUndefined()
    expect(mockSubmitBrandForReview).toHaveBeenCalledTimes(1)
  })

  it('returns error when rate limited', async () => {
    mockRateLimiterCheck.mockReturnValue({ allowed: false })

    const result = await submitBrand({
      name: 'Test Brand',
      website: 'https://test.com',
      region: 'taipei',
      isOwner: false,
      purchaseLinks: [],
      pdpaConsent: true,
      socialLinks: { instagram: '', threads: '', facebook: '', website: '' },
      sourceAttribution: 'found_online',
      turnstileToken: 'test-token',
      honeypot: '',
    })

    expect(result).toEqual({ error: expect.any(String) })
    expect(mockSubmitBrandForReview).not.toHaveBeenCalled()
  })
})
