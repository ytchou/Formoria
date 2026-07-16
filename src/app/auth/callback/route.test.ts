import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockExchangeCodeForSession = vi.fn()
const mockCookieGet = vi.fn()
const mockCookieDelete = vi.fn()
const mockEnrollInMarketingEmails = vi.fn()

const mockFrom = vi.fn().mockReturnValue({
  select: vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: null }),
    }),
  }),
})

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      exchangeCodeForSession: mockExchangeCodeForSession,
    },
  }),
  createServiceClient: vi.fn().mockReturnValue({
    from: mockFrom,
  }),
}))

vi.mock('@/lib/services/marketing-email-consent', () => ({
  enrollInMarketingEmails: mockEnrollInMarketingEmails,
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: mockCookieGet,
    delete: mockCookieDelete,
    set: vi.fn(),
  }),
  headers: vi.fn().mockResolvedValue(
    new Map([
      ['host', 'app.example.com'],
      ['x-forwarded-proto', 'https'],
    ])
  ),
}))

vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://app.example.com')

const { headers: headersMock } = await import('next/headers')
const { GET } = await import('./route')

describe('GET /auth/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCookieGet.mockReturnValue(undefined)
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://app.example.com')

    mockExchangeCodeForSession.mockResolvedValue({
      data: {
        user: { id: 'u1', email: 'u@example.com' },
        session: {},
      },
      error: null,
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('redirects to the public site origin instead of the internal request host', async () => {
    const request = new NextRequest('http://localhost:8080/auth/callback?code=test-code')

    const response = await GET(request)
    const location = response.headers.get('location')

    expect(response.status).toBeGreaterThanOrEqual(300)
    expect(response.status).toBeLessThan(400)
    expect(location).toBeTruthy()

    const loc = new URL(location!)
    expect(loc.host).toBe('app.example.com')
    expect(loc.host).not.toBe('localhost:8080')
    expect(loc.pathname).toBe('/dashboard')
  })

  it('appends is_new_user=1 when user was created within the last 60 seconds', async () => {
    mockExchangeCodeForSession.mockResolvedValue({
      data: {
        user: {
          id: 'u1',
          email: 'u@example.com',
          created_at: new Date().toISOString(),
        },
        session: {},
      },
      error: null,
    })

    const request = new NextRequest('http://localhost:8080/auth/callback?code=test-code')

    const response = await GET(request)
    const location = response.headers.get('location')

    expect(location).toBeTruthy()

    const loc = new URL(location!)
    expect(loc.pathname).toBe('/dashboard')
    expect(loc.searchParams.get('is_new_user')).toBe('1')
  })

  it('does not append is_new_user when user was created more than 60 seconds ago', async () => {
    mockExchangeCodeForSession.mockResolvedValue({
      data: {
        user: {
          id: 'u1',
          email: 'u@example.com',
          created_at: new Date(Date.now() - 120_000).toISOString(),
        },
        session: {},
      },
      error: null,
    })

    const request = new NextRequest('http://localhost:8080/auth/callback?code=test-code')

    const response = await GET(request)
    const location = response.headers.get('location')

    expect(location).toBeTruthy()

    const loc = new URL(location!)
    expect(loc.searchParams.has('is_new_user')).toBe(false)
  })

  it('consumes explicit Google sign-up consent after session exchange', async () => {
    mockCookieGet.mockImplementation((name: string) => {
      if (name === 'post_auth_marketing_opt_in') return { value: '1' }
      if (name === 'post_auth_marketing_locale') return { value: 'en' }
      return undefined
    })

    const request = new NextRequest('http://localhost:8080/auth/callback?code=test-code')
    await GET(request)

    expect(mockEnrollInMarketingEmails).toHaveBeenCalledWith(
      expect.objectContaining({ from: expect.any(Function) }),
      {
        email: 'u@example.com',
        userId: 'u1',
        locale: 'en',
        source: 'google_signup',
        newsletter: true,
        lifecycle: true,
      },
    )
    expect(mockCookieDelete).toHaveBeenCalledWith('post_auth_marketing_opt_in')
    expect(mockCookieDelete).toHaveBeenCalledWith('post_auth_marketing_locale')
  })
})

describe('GET /auth/callback — localhost redirect regression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://formoria.com')

    vi.mocked(headersMock).mockResolvedValue(
      new Map([
        ['host', 'localhost:3000'],
      ]) as unknown as Awaited<ReturnType<typeof headersMock>>
    )

    mockExchangeCodeForSession.mockResolvedValue({
      data: {
        user: { id: 'u1', email: 'u@example.com' },
        session: {},
      },
      error: null,
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('redirects to localhost when running on localhost, not to production', async () => {
    const request = new NextRequest('http://localhost:3000/auth/callback?code=test-code')

    const response = await GET(request)
    const location = response.headers.get('location')

    expect(location).toBeTruthy()

    const loc = new URL(location!)
    expect(loc.host).toBe('localhost:3000')
    expect(loc.protocol).toBe('http:')
    expect(loc.host).not.toBe('formoria.com')
  })
})
