import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSubmissionSchema } from '@/lib/validations/submission'
import zhMessages from '../../../../../messages/zh-TW.json'

const {
  mockUpload,
  mockGetPublicUrl,
  mockGetUser,
  mockCreateBrand,
  mockCreateSubmission,
  mockVerifyTurnstileToken,
  mockScanContent,
  mockSaveModerationFlags,
  mockRateLimiterCheck,
} = vi.hoisted(() => {
  const mockRateLimiterCheck = vi.fn().mockReturnValue({ allowed: true })
  return {
    mockUpload: vi.fn(),
    mockGetPublicUrl: vi.fn(),
    mockGetUser: vi.fn(),
    mockCreateBrand: vi.fn(),
    mockCreateSubmission: vi.fn(),
    mockVerifyTurnstileToken: vi.fn(),
    mockScanContent: vi.fn(),
    mockSaveModerationFlags: vi.fn(),
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
      storage: {
        from: vi.fn(() => ({
          upload: mockUpload,
          getPublicUrl: mockGetPublicUrl,
        })),
      },
    })
  ),
  createServiceClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        upload: mockUpload,
        getPublicUrl: mockGetPublicUrl,
      })),
    },
  })),
}))

vi.mock('@/lib/services/brands', () => ({
  createBrand: mockCreateBrand,
}))

vi.mock('@/lib/services/submissions', () => ({
  createSubmission: mockCreateSubmission,
}))

vi.mock('@/lib/security/turnstile', () => ({
  verifyTurnstileToken: mockVerifyTurnstileToken,
}))

vi.mock('@/lib/services/moderation', () => ({
  scanContent: mockScanContent,
  saveModerationFlags: mockSaveModerationFlags,
}))

vi.mock('@/lib/security/rate-limiter', () => ({
  createInMemoryRateLimiter: () => ({ check: mockRateLimiterCheck }),
}))

import { getTranslations } from 'next-intl/server'
import { downloadAndStoreImages } from '@/lib/services/image-download'
import { submitBrand } from '@/app/[locale]/submit/actions'

describe('downloadAndStoreImages', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockUpload.mockResolvedValue({ error: null })
    mockGetPublicUrl.mockReturnValue({
      data: { publicUrl: 'https://supabase.co/storage/brand-images/photo.jpg' },
    })
  })

  it('downloads external images and returns storage URLs', async () => {
    const mockBlob = new Blob(['fake-image'], { type: 'image/jpeg' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
        headers: new Headers({ 'content-type': 'image/jpeg' }),
      })
    )

    const result = await downloadAndStoreImages(
      ['https://example.com/photo1.jpg', 'https://example.com/photo2.jpg'],
      'brand-123'
    )

    expect(result).toHaveLength(2)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('returns null in place for failed image downloads (index-aligned)', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          blob: () => Promise.resolve(new Blob(['img'])),
          headers: new Headers({ 'content-type': 'image/jpeg' }),
        })
        .mockResolvedValueOnce({ ok: false, status: 404 })
    )

    const result = await downloadAndStoreImages(
      ['https://example.com/good.jpg', 'https://example.com/missing.jpg'],
      'brand-123'
    )

    expect(result).toHaveLength(2)
    expect(result[0]).toBe('https://supabase.co/storage/brand-images/photo.jpg')
    expect(result[1]).toBeNull()
  })

  it('returns empty array when no URLs provided', async () => {
    const result = await downloadAndStoreImages([], 'brand-123')
    expect(result).toEqual([])
  })
})

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
    mockCreateBrand.mockResolvedValue({ id: 'brand-123' })
    mockCreateSubmission.mockResolvedValue({ id: 'submission-123' })
    mockScanContent.mockReturnValue({ riskLevel: 'clean', flags: [] })
    mockSaveModerationFlags.mockResolvedValue(undefined)
  })

  it('owner payload without logoUrl fails owner schema', () => {
    const schema = createSubmissionSchema(true)
    const ownerPayload = {
      name: 'Test Brand',
      description: 'Long enough description for the test',
      category: 'fashion',
      isOwner: true,
      purchaseLinks: [{ platform: 'shopify', url: 'https://shop.com' }],
      pdpaConsent: true,
      socialLinks: { instagram: '', threads: '', facebook: '', website: 'https://test.com' },
      productPhotos: [],
      brandHighlights: '',
      retailLocations: [],
      turnstileToken: 'test-token',
    }
    // Missing logoUrl — should fail
    expect(schema.safeParse(ownerPayload).success).toBe(false)
  })

  it('community payload without logoUrl passes community schema', () => {
    const schema = createSubmissionSchema(false)
    const communityPayload = {
      name: 'Test Brand',
      description: 'Long enough description for the community submission test',
      category: 'fashion',
      isOwner: false,
      purchaseLinks: [],
      pdpaConsent: true,
      socialLinks: { instagram: '', threads: '', facebook: '', website: 'https://test.com' },
      sourceAttribution: 'found_online',
      productPhotos: [],
      brandHighlights: '',
      retailLocations: [],
      turnstileToken: 'test-token',
    }
    expect(schema.safeParse(communityPayload).success).toBe(true)
  })

  it('omits the dormant brand column from the brand insert payload', async () => {
    await submitBrand({
      name: 'Test Brand',
      description: 'Long enough description for the brand insert payload test',
      category: 'fashion',
      logoUrl: 'https://example.com/logo.webp',
      isOwner: true,
      purchaseLinks: [{ platform: 'shopify', url: 'https://shop.com' }],
      pdpaConsent: true,
      socialLinks: { instagram: '', threads: '', facebook: '', website: 'https://test.com' },
      productPhotos: [],
      brandHighlights: '',
      retailLocations: [],
      turnstileToken: 'test-token',
    })

    expect(mockCreateBrand).toHaveBeenCalledTimes(1)
    const payload = mockCreateBrand.mock.calls[0][0]
    expect('founder' in payload).toBe(false)
  })

  it('stores structured suggestedTags with region and values', async () => {
    await submitBrand({
      name: 'Test Brand',
      description: 'A'.repeat(40),
      category: 'fashion',
      region: 'taipei',
      valueTags: ['sustainability'],
      logoUrl: 'https://example.com/logo.png',
      isOwner: false,
      purchaseLinks: [],
      pdpaConsent: true,
      socialLinks: { instagram: '', threads: '', facebook: '', website: '' },
      sourceAttribution: 'found_online',
      productPhotos: [],
      brandHighlights: '',
      retailLocations: [],
      turnstileToken: 'test-token',
    })

    expect(mockCreateSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestedTags: { region: 'taipei', values: ['sustainability'] },
      })
    )
  })

  it('scans brand fields after schema validation passes', async () => {
    await submitBrand({
      name: 'Test Brand',
      description: 'Long enough description for moderation scanning',
      category: 'fashion',
      logoUrl: 'https://example.com/logo.png',
      isOwner: false,
      purchaseLinks: [{ platform: 'shopify', url: 'https://shop.com/product' }],
      pdpaConsent: true,
      socialLinks: { instagram: '', threads: '', facebook: '', website: 'https://test.com' },
      sourceAttribution: 'found_online',
      productPhotos: [],
      brandHighlights: 'Handmade in Taipei',
      retailLocations: [],
      turnstileToken: 'test-token',
    })

    expect(mockScanContent).toHaveBeenCalledWith({
      fields: {
        name: 'Test Brand',
        description: 'Long enough description for moderation scanning',
        brandHighlights: 'Handmade in Taipei',
        website: 'https://test.com',
        purchaseUrl: 'https://shop.com/product',
      },
      brandName: 'Test Brand',
    })
  })

  it('saves moderation flags after creating the brand when flags exist', async () => {
    const flags = [
      {
        fieldName: 'description',
        tier: 'tier2',
        reason: 'Email address detected',
        flaggedContent: 'Email us at spam@example.com',
      },
    ]
    mockScanContent.mockReturnValue({ riskLevel: 'medium', flags })

    await submitBrand({
      name: 'Test Brand',
      description: 'Email us at spam@example.com for a long enough test',
      category: 'fashion',
      logoUrl: 'https://example.com/logo.png',
      isOwner: false,
      purchaseLinks: [],
      pdpaConsent: true,
      socialLinks: { instagram: '', threads: '', facebook: '', website: '' },
      sourceAttribution: 'found_online',
      productPhotos: [],
      brandHighlights: '',
      retailLocations: [],
      turnstileToken: 'test-token',
    })

    expect(mockCreateBrand).toHaveBeenCalledTimes(1)
    expect(mockSaveModerationFlags).toHaveBeenCalledWith('brand-123', 'user-123', flags)
    expect(mockSaveModerationFlags.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockCreateBrand.mock.invocationCallOrder[0]
    )
  })

  it('does not save moderation flags when scan returns clean', async () => {
    mockScanContent.mockReturnValue({ riskLevel: 'clean', flags: [] })

    await submitBrand({
      name: 'Test Brand',
      description: 'Long enough clean description for moderation',
      category: 'fashion',
      logoUrl: 'https://example.com/logo.png',
      isOwner: false,
      purchaseLinks: [],
      pdpaConsent: true,
      socialLinks: { instagram: '', threads: '', facebook: '', website: '' },
      sourceAttribution: 'found_online',
      productPhotos: [],
      brandHighlights: '',
      retailLocations: [],
      turnstileToken: 'test-token',
    })

    expect(mockSaveModerationFlags).not.toHaveBeenCalled()
  })

  it('continues submission when saving moderation flags fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const flags = [
      {
        fieldName: 'name',
        tier: 'tier1',
        reason: 'English spam phrase detected: buy now',
        flaggedContent: 'Buy Now Brand',
      },
    ]
    mockScanContent.mockReturnValue({ riskLevel: 'high', flags })
    mockSaveModerationFlags.mockRejectedValue(new Error('moderation insert failed'))

    const result = await submitBrand({
      name: 'Buy Now Brand',
      description: 'Long enough description for moderation failure test',
      category: 'fashion',
      logoUrl: 'https://example.com/logo.png',
      isOwner: false,
      purchaseLinks: [],
      pdpaConsent: true,
      socialLinks: { instagram: '', threads: '', facebook: '', website: '' },
      sourceAttribution: 'found_online',
      productPhotos: [],
      brandHighlights: '',
      retailLocations: [],
      turnstileToken: 'test-token',
    })

    expect(result).toBeUndefined()
    expect(mockCreateSubmission).toHaveBeenCalledTimes(1)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Save moderation flags error:',
      expect.any(Error)
    )
  })
})
