import { describe, it, expect, vi, beforeEach } from 'vitest'

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
