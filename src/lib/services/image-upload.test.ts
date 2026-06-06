import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createServiceClient } from '@/lib/supabase/server'
import { deleteBrandImages, diffRemovedImageUrls, storageKeyFromPublicUrl } from './image-upload'

const mockRemove = vi.fn()
const mockFrom = vi.fn(() => ({
  remove: mockRemove,
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({
    storage: {
      from: mockFrom,
    },
  })),
}))

const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://abc.supabase.co'
const publicUrl = (key: string) => `${SUPA}/storage/v1/object/public/brand-images/${key}`

describe('storageKeyFromPublicUrl', () => {
  it('extracts the storage key from a brand-images public URL', () => {
    expect(storageKeyFromPublicUrl(publicUrl('brands/abc/logo-123.webp'))).toBe(
      'brands/abc/logo-123.webp'
    )
  })

  it('returns null for empty, foreign, or non-brand-images URLs', () => {
    expect(storageKeyFromPublicUrl(`${SUPA}/storage/v1/object/public/avatars/x.webp`)).toBeNull()
    expect(storageKeyFromPublicUrl('https://evil.example.com/x.png')).toBeNull()
    expect(storageKeyFromPublicUrl('')).toBeNull()
  })
})

describe('diffRemovedImageUrls', () => {
  it('returns URLs present in prev but missing from next', () => {
    expect(diffRemovedImageUrls(['a', 'b', 'c'], ['a', 'c'])).toEqual(['b'])
    expect(diffRemovedImageUrls(['old.webp'], ['new.webp'])).toEqual(['old.webp'])
    expect(diffRemovedImageUrls(['a'], ['a', 'b'])).toEqual([])
  })

  it('tolerates nullish inputs', () => {
    expect(diffRemovedImageUrls(undefined, ['a'])).toEqual([])
    expect(diffRemovedImageUrls(['a'], undefined)).toEqual(['a'])
    expect(diffRemovedImageUrls(null, null)).toEqual([])
  })
})

describe('deleteBrandImages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFrom.mockReturnValue({
      remove: mockRemove,
    })
    mockRemove.mockResolvedValue({ data: null, error: null })
  })

  it('removes only keys extracted from brand-images public URLs', async () => {
    await expect(
      deleteBrandImages([publicUrl('brands/x/a.webp'), 'https://evil.example.com/ext.png'])
    ).resolves.toBeUndefined()

    expect(createServiceClient).toHaveBeenCalledTimes(1)
    expect(mockFrom).toHaveBeenCalledWith('brand-images')
    expect(mockRemove).toHaveBeenCalledWith(['brands/x/a.webp'])
  })

  it('returns without creating a client when there are no keys to delete', async () => {
    await expect(deleteBrandImages([])).resolves.toBeUndefined()

    expect(createServiceClient).not.toHaveBeenCalled()
    expect(mockFrom).not.toHaveBeenCalled()
    expect(mockRemove).not.toHaveBeenCalled()
  })
})
