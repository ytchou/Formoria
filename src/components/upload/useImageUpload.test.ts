// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useImageUpload } from './useImageUpload'

const uploadConfig = {
  bucket: 'brand-images',
  path: 'brands/taiwan-tea-company',
  invalidTypeMessage: 'Choose an image file.',
  fileTooLargeMessage: 'The image must be 5MB or smaller.',
  uploadFailedMessage: 'Upload failed. Please try again.',
}

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
      useImageUpload(uploadConfig)
    )
    expect(result.current.status).toBe('idle')
    expect(result.current.url).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('rejects files over 5MB', async () => {
    const { result } = renderHook(() =>
      useImageUpload(uploadConfig)
    )
    const bigFile = createMockFile('huge.jpg', 6 * 1024 * 1024, 'image/jpeg')

    await act(async () => {
      await result.current.upload(bigFile)
    })

    expect(result.current.status).toBe('error')
    expect(result.current.error).toMatch(/5MB/)
  })

  it('rejects non-image files', async () => {
    const { result } = renderHook(() =>
      useImageUpload(uploadConfig)
    )
    const textFile = createMockFile('doc.txt', 100, 'text/plain')

    await act(async () => {
      await result.current.upload(textFile)
    })

    expect(result.current.status).toBe('error')
    expect(result.current.error).toMatch(/image/i)
  })

  it('uploads and returns public URL on success', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ url: 'https://storage.example.com/brands/taiwan-tea-company/logo.webp' }),
        { status: 200 }
      )
    )

    const { result } = renderHook(() =>
      useImageUpload(uploadConfig)
    )
    const file = createMockFile('logo.png', 1024, 'image/png')

    await act(async () => {
      await result.current.upload(file)
    })

    expect(result.current.status).toBe('success')
    expect(result.current.url).toBe(
      'https://storage.example.com/brands/taiwan-tea-company/logo.webp',
    )
  })

  it('allows caller-provided file types and upload fields', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          key: 'claim-proofs/2fd12f4c-51a6-4af4-9dac-7dd12a5ec914/taiwan-tea-company/business-registration.pdf',
        }),
        { status: 200 }
      )
    )

    const { result } = renderHook(() =>
      useImageUpload({
        ...uploadConfig,
        bucket: 'claim-proofs',
        path: 'maría-garcía/taiwan-tea-company',
        acceptedTypes: ['application/pdf'],
        uploadFields: { proofType: 'business_doc' },
      })
    )
    const file = createMockFile('business-registration.pdf', 1024, 'application/pdf')

    await act(async () => {
      await result.current.upload(file)
    })

    expect(result.current.status).toBe('success')
    expect(result.current.key).toBe(
      'claim-proofs/2fd12f4c-51a6-4af4-9dac-7dd12a5ec914/taiwan-tea-company/business-registration.pdf',
    )
    const body = fetchMock.mock.calls[0]?.[1]?.body
    expect(body).toBeInstanceOf(FormData)
    expect((body as FormData).get('proofType')).toBe('business_doc')
  })

  it('returns staged metadata from a custom upload endpoint', async () => {
    const stagedImage = {
      id: '7a0ea90d-4a8c-4d2f-91cf-a6864a41a26d',
      submissionId: 'b5cd2968-6587-48fe-9c6a-6104db171db5',
      url: 'https://storage.example.com/submission/image.webp',
      status: 'draft',
    }
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(stagedImage), { status: 201 })
    )
    const { result } = renderHook(() =>
      useImageUpload({
        ...uploadConfig,
        path: 'submissions/taiwan-tea-company',
        endpoint: '/api/admin/submissions/b5cd2968-6587-48fe-9c6a-6104db171db5/images',
      })
    )

    let uploaded
    await act(async () => {
      uploaded = await result.current.upload(
        createMockFile('detail.png', 1024, 'image/png')
      )
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/submissions/b5cd2968-6587-48fe-9c6a-6104db171db5/images',
      expect.objectContaining({ method: 'POST' })
    )
    expect(uploaded).toMatchObject({
      url: stagedImage.url,
      metadata: stagedImage,
    })
    expect(result.current.metadata).toEqual(stagedImage)
  })

  it('handles upload errors gracefully', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Bucket not found' }), { status: 500 })
    )

    const { result } = renderHook(() =>
      useImageUpload(uploadConfig)
    )
    const file = createMockFile('logo.png', 1024, 'image/png')

    await act(async () => {
      await result.current.upload(file)
    })

    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe(uploadConfig.uploadFailedMessage)
  })
})
