import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — declared at top level to avoid hoisting issues
// ---------------------------------------------------------------------------

const mockGetUser = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: mockGetUser,
    },
  }),
}))

const mockProcessImage = vi.fn()
vi.mock('@/lib/security/image-processor', () => ({
  processImage: mockProcessImage,
}))

const mockUploadPublicImage = vi.fn()
const mockUploadPrivateImage = vi.fn()
const mockUploadPrivateFile = vi.fn()
const mockGetUploadImageProcessingConfig = vi.fn().mockReturnValue({})
vi.mock('@/lib/services/image-upload', () => ({
  ALLOWED_UPLOAD_BUCKETS: ['brand-images', 'claim-proofs'],
  uploadPublicImage: mockUploadPublicImage,
  uploadPrivateImage: mockUploadPrivateImage,
  uploadPrivateFile: mockUploadPrivateFile,
  getUploadImageProcessingConfig: mockGetUploadImageProcessingConfig,
}))

// Import route AFTER mocks are registered
const { POST } = await import('./route')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFormData(
  options: {
    file?: File | null
    path?: string | null
    bucket?: string | null
    proofType?: string | null
    omitFile?: boolean
  } = {}
): FormData {
  const fd = new FormData()
  if (!options.omitFile) {
    const file = options.file ?? new File([Buffer.from('fake-image-data')], 'test.jpg', { type: 'image/jpeg' })
    fd.append('file', file)
  }
  if (options.path !== undefined && options.path !== null) {
    fd.append('path', options.path)
  }
  if (options.bucket !== undefined && options.bucket !== null) {
    fd.append('bucket', options.bucket)
  }
  if (options.proofType !== undefined && options.proofType !== null) {
    fd.append('proofType', options.proofType)
  }
  return fd
}

function makeRequest(formData: FormData): Request {
  return new Request('http://localhost/api/upload', {
    method: 'POST',
    body: formData,
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when user is not authenticated', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: new Error('No session'),
    })

    const fd = makeFormData({ path: 'logos/brand-1', bucket: 'brand-images' })
    const res = await POST(makeRequest(fd))
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toMatch(/authentication/i)
  })

  it('returns 400 for path-traversal with ".."', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'test@example.com' } },
      error: null,
    })

    const fd = makeFormData({ path: '../etc/passwd', bucket: 'brand-images' })
    const res = await POST(makeRequest(fd))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/invalid path/i)
  })

  it('returns 400 for path-traversal with leading "/"', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'test@example.com' } },
      error: null,
    })

    const fd = makeFormData({ path: '/absolute/path', bucket: 'brand-images' })
    const res = await POST(makeRequest(fd))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/invalid path/i)
  })

  it('returns 400 for an invalid (disallowed) bucket', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'test@example.com' } },
      error: null,
    })

    const fd = makeFormData({ path: 'logos/brand-1', bucket: 'system-private' })
    const res = await POST(makeRequest(fd))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/invalid bucket/i)
  })

  it('returns 403 when a claim-proof path is outside the authenticated user namespace', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'test@example.com' } },
      error: null,
    })

    const fd = makeFormData({ path: 'other-user/brand-1', bucket: 'claim-proofs' })
    const res = await POST(makeRequest(fd))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/invalid path/i)
    expect(mockProcessImage).not.toHaveBeenCalled()
    expect(mockUploadPrivateImage).not.toHaveBeenCalled()
  })

  it('returns 400 when no file is provided', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'test@example.com' } },
      error: null,
    })

    const fd = makeFormData({ omitFile: true, path: 'logos/brand-1', bucket: 'brand-images' })
    const res = await POST(makeRequest(fd))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/no file/i)
  })

  it('returns 400 when image processing fails', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'test@example.com' } },
      error: null,
    })
    mockProcessImage.mockRejectedValue(new Error('Unsupported format'))

    const fd = makeFormData({ path: 'logos/brand-1', bucket: 'brand-images' })
    const res = await POST(makeRequest(fd))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('An unexpected error occurred')
  })

  it('returns 200 with url, width, height on happy path', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'test@example.com' } },
      error: null,
    })
    mockProcessImage.mockResolvedValue({
      buffer: Buffer.from('processed-webp'),
      width: 800,
      height: 600,
    })
    mockUploadPublicImage.mockResolvedValue({
      url: 'https://cdn.example.com/brand-images/logos/brand-1/123-uuid.webp',
    })

    const fd = makeFormData({ path: 'logos/brand-1', bucket: 'brand-images' })
    const res = await POST(makeRequest(fd))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.url).toBe('https://cdn.example.com/brand-images/logos/brand-1/123-uuid.webp')
    expect(body.width).toBe(800)
    expect(body.height).toBe(600)
    expect(body.key).toBeUndefined()
    expect(mockUploadPublicImage).toHaveBeenCalledWith({
      bucket: 'brand-images',
      path: expect.stringMatching(/^logos\/brand-1\/\d+-[0-9a-f-]+\.webp$/),
      data: Buffer.from('processed-webp'),
      contentType: 'image/webp',
    })
  })

  it('returns only the bucket-prefixed server key for claim-proof uploads', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'test@example.com' } },
      error: null,
    })
    mockProcessImage.mockResolvedValue({
      buffer: Buffer.from('processed-webp'),
      width: 1200,
      height: 900,
    })
    mockUploadPrivateImage.mockResolvedValue({
      key: 'claim-proofs/user-1/brand-1/123-uuid.webp',
    })

    const fd = makeFormData({ path: 'user-1/brand-1', bucket: 'claim-proofs' })
    const res = await POST(makeRequest(fd))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      key: 'claim-proofs/user-1/brand-1/123-uuid.webp',
      width: 1200,
      height: 900,
    })
    expect(mockUploadPrivateImage).toHaveBeenCalledWith({
      bucket: 'claim-proofs',
      path: expect.stringMatching(/^user-1\/brand-1\/\d+-[0-9a-f-]+\.webp$/),
      data: Buffer.from('processed-webp'),
      contentType: 'image/webp',
    })
  })

  it('stores business document PDFs as raw private files without image processing', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-pdf', email: 'test@example.com' } },
      error: null,
    })
    mockUploadPrivateFile.mockResolvedValue({
      key: 'claim-proofs/user-pdf/brand-1/123-uuid.pdf',
    })

    const fd = makeFormData({
      file: new File([Buffer.from('%PDF-1.7\nbody')], 'business.pdf', { type: 'application/pdf' }),
      path: 'user-pdf/brand-1',
      bucket: 'claim-proofs',
      proofType: 'business_doc',
    })
    const res = await POST(makeRequest(fd))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ key: 'claim-proofs/user-pdf/brand-1/123-uuid.pdf' })
    expect(mockProcessImage).not.toHaveBeenCalled()
    expect(mockUploadPrivateFile).toHaveBeenCalledWith({
      bucket: 'claim-proofs',
      path: expect.stringMatching(/^user-pdf\/brand-1\/\d+-[0-9a-f-]+\.pdf$/),
      data: Buffer.from('%PDF-1.7\nbody'),
      contentType: 'application/pdf',
    })
  })

  it('rejects PDFs for non-business document proof uploads', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-pdf-reject', email: 'test@example.com' } },
      error: null,
    })

    const fd = makeFormData({
      file: new File([Buffer.from('%PDF-1.7\nbody')], 'business.pdf', { type: 'application/pdf' }),
      path: 'user-pdf-reject/brand-1',
      bucket: 'claim-proofs',
      proofType: 'backend_screenshot',
    })
    const res = await POST(makeRequest(fd))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/business documents/i)
    expect(mockProcessImage).not.toHaveBeenCalled()
    expect(mockUploadPrivateFile).not.toHaveBeenCalled()
  })
})
