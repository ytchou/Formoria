// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useImageUpload } from './useImageUpload'

function createMockFile(name: string, size: number, type: string): File {
  const buffer = new ArrayBuffer(size)
  return new File([buffer], name, { type })
}

describe('useImageUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns idle status initially', () => {
    const { result } = renderHook(() =>
      useImageUpload({ bucket: 'brand-images', path: 'test' })
    )
    expect(result.current.status).toBe('idle')
    expect(result.current.url).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('rejects files over 5MB', async () => {
    const { result } = renderHook(() =>
      useImageUpload({ bucket: 'brand-images', path: 'test' })
    )
    const bigFile = createMockFile('huge.jpg', 6 * 1024 * 1024, 'image/jpeg')

    await act(async () => {
      await result.current.upload(bigFile, 'logo.webp')
    })

    expect(result.current.status).toBe('error')
    expect(result.current.error).toMatch(/5MB/)
  })

  it('rejects non-image files', async () => {
    const { result } = renderHook(() =>
      useImageUpload({ bucket: 'brand-images', path: 'test' })
    )
    const textFile = createMockFile('doc.txt', 100, 'text/plain')

    await act(async () => {
      await result.current.upload(textFile, 'logo.webp')
    })

    expect(result.current.status).toBe('error')
    expect(result.current.error).toMatch(/image/i)
  })

  it('uploads and returns public URL on success', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ url: 'https://storage.example.com/test/logo.webp' }),
        { status: 200 }
      )
    )

    const { result } = renderHook(() =>
      useImageUpload({ bucket: 'brand-images', path: 'test' })
    )
    const file = createMockFile('logo.png', 1024, 'image/png')

    await act(async () => {
      await result.current.upload(file, 'logo.webp')
    })

    expect(result.current.status).toBe('success')
    expect(result.current.url).toBe('https://storage.example.com/test/logo.webp')
  })

  it('handles upload errors gracefully', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Bucket not found' }), { status: 500 })
    )

    const { result } = renderHook(() =>
      useImageUpload({ bucket: 'brand-images', path: 'test' })
    )
    const file = createMockFile('logo.png', 1024, 'image/png')

    await act(async () => {
      await result.current.upload(file, 'logo.webp')
    })

    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('Bucket not found')
  })
})
