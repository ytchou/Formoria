import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSubmissionSchema } from '@/lib/validations/submission'

const mockUpload = vi.fn()
const mockGetPublicUrl = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: vi.fn() },
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

import { downloadAndStoreImages } from '@/lib/services/image-download'

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
})
