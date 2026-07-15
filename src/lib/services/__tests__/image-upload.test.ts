import { describe, it, expect, vi, beforeEach } from 'vitest'
import { uploadPrivateImage, uploadPublicImage } from '@/lib/services/image-upload'

const uploadMock = vi.fn()
const getPublicUrlMock = vi.fn(() => ({ data: { publicUrl: 'https://x.supabase.co/pub' } }))
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    storage: { from: () => ({ upload: uploadMock, getPublicUrl: getPublicUrlMock }) },
  }),
}))

describe('image upload service', () => {
  beforeEach(() => {
    uploadMock.mockReset()
    getPublicUrlMock.mockClear()
    uploadMock.mockResolvedValue({ data: { path: 'u1/b1/x.webp' }, error: null })
  })

  it('returns the storage key (not a public URL) for the private claim-proofs bucket', async () => {
    const res = await uploadPrivateImage({
      bucket: 'claim-proofs',
      path: 'u1/b1/x.webp',
      data: Buffer.from('x'),
      contentType: 'image/webp',
    })

    expect(res.key).toBe('claim-proofs/u1/b1/x.webp')
    expect(uploadMock).toHaveBeenCalledWith('u1/b1/x.webp', Buffer.from('x'), {
      cacheControl: '31536000',
      contentType: 'image/webp',
      upsert: false,
    })
    expect(getPublicUrlMock).not.toHaveBeenCalled()
  })

  it('still returns a public URL for the public brand-images bucket', async () => {
    const res = await uploadPublicImage({
      bucket: 'brand-images',
      path: 'b/y.webp',
      data: Buffer.from('y'),
      contentType: 'image/webp',
    })

    expect(res.url).toBe('https://x.supabase.co/pub')
    expect(uploadMock).toHaveBeenCalledWith(
      'b/y.webp',
      Buffer.from('y'),
      expect.objectContaining({ cacheControl: '31536000' }),
    )
    expect(getPublicUrlMock).toHaveBeenCalledWith('b/y.webp')
  })
})
