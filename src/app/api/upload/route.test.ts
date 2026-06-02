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

const mockUploadProcessedImage = vi.fn()
vi.mock('@/lib/services/image-upload', () => ({
  ALLOWED_UPLOAD_BUCKETS: ['brand-images'],
  uploadProcessedImage: mockUploadProcessedImage,
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
    expect(body.error).toBe('Unsupported format')
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
    mockUploadProcessedImage.mockResolvedValue({
      url: 'https://cdn.example.com/brand-images/logos/brand-1/123-uuid.webp',
      width: 800,
      height: 600,
    })

    const fd = makeFormData({ path: 'logos/brand-1', bucket: 'brand-images' })
    const res = await POST(makeRequest(fd))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.url).toBe('https://cdn.example.com/brand-images/logos/brand-1/123-uuid.webp')
    expect(body.width).toBe(800)
    expect(body.height).toBe(600)
    expect(mockUploadProcessedImage).toHaveBeenCalledWith(
      expect.objectContaining({ width: 800, height: 600 }),
      'logos/brand-1',
      'brand-images'
    )
  })
})
