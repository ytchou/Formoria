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
} = vi.hoisted(() => ({
  mockUpload: vi.fn(),
  mockGetPublicUrl: vi.fn(),
  mockGetUser: vi.fn(),
  mockCreateBrand: vi.fn(),
  mockCreateSubmission: vi.fn(),
  mockVerifyTurnstileToken: vi.fn(),
}))

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

  it('skips failed image downloads gracefully', async () => {
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

    expect(result).toHaveLength(1)
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
  })

  it('owner payload without logoUrl fails owner schema', () => {
    const schema = createSubmissionSchema(true)
    const ownerPayload = {
      name: 'Test Brand',
      description: 'Long enough description for the test',
      category: 'fashion',
      tags: [],
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
      description: 'Long enough description for the test',
      category: 'fashion',
      tags: [],
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
      description: 'Long enough description for the test',
      category: 'fashion',
      tags: [],
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
})
