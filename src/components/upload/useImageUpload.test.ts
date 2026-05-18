// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useImageUpload } from './useImageUpload'

const mockUpload = vi.fn()
const mockGetPublicUrl = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        upload: mockUpload,
        getPublicUrl: mockGetPublicUrl,
      }),
    },
  }),
}))

vi.mock('./resize-image', () => ({
  resizeImage: vi.fn().mockResolvedValue(new Blob(['fake'], { type: 'image/webp' })),
}))

function createMockFile(name: string, size: number, type: string): File {
  const buffer = new ArrayBuffer(size)
  return new File([buffer], name, { type })
}

describe('useImageUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpload.mockResolvedValue({
      data: { path: 'test/logo.webp' },
      error: null,
    })
    mockGetPublicUrl.mockReturnValue({
      data: { publicUrl: 'https://storage.example.com/test/logo.webp' },
    })
  })

  it('returns idle status initially', () => {
    const { result } = renderHook(() =>
      useImageUpload({ bucket: 'brand-assets', path: 'test' })
    )
    expect(result.current.status).toBe('idle')
    expect(result.current.url).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('rejects files over 5MB', async () => {
    const { result } = renderHook(() =>
      useImageUpload({ bucket: 'brand-assets', path: 'test' })
    )
    const bigFile = createMockFile('huge.jpg', 6 * 1024 * 1024, 'image/jpeg')

    await act(async () => {
      await result.current.upload(bigFile, 'logo.webp')
    })

    expect(result.current.status).toBe('error')
    expect(result.current.error).toMatch(/5MB/)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('rejects non-image files', async () => {
    const { result } = renderHook(() =>
      useImageUpload({ bucket: 'brand-assets', path: 'test' })
    )
    const textFile = createMockFile('doc.txt', 100, 'text/plain')

    await act(async () => {
      await result.current.upload(textFile, 'logo.webp')
    })

    expect(result.current.status).toBe('error')
    expect(result.current.error).toMatch(/image/i)
  })

  it('uploads and returns public URL on success', async () => {
    const { result } = renderHook(() =>
      useImageUpload({ bucket: 'brand-assets', path: 'test' })
    )
    const file = createMockFile('logo.png', 1024, 'image/png')

    await act(async () => {
      await result.current.upload(file, 'logo.webp')
    })

    expect(result.current.status).toBe('success')
    expect(result.current.url).toBe(
      'https://storage.example.com/test/logo.webp'
    )
    expect(mockUpload).toHaveBeenCalledOnce()
  })

  it('handles upload errors gracefully', async () => {
    mockUpload.mockResolvedValue({
      data: null,
      error: { message: 'Bucket not found' },
    })

    const { result } = renderHook(() =>
      useImageUpload({ bucket: 'brand-assets', path: 'test' })
    )
    const file = createMockFile('logo.png', 1024, 'image/png')

    await act(async () => {
      await result.current.upload(file, 'logo.webp')
    })

    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('Bucket not found')
  })
})
