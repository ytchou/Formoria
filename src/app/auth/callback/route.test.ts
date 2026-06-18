import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockExchangeCodeForSession = vi.fn()

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

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined),
    delete: vi.fn(),
    set: vi.fn(),
  }),
}))

vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://app.example.com')

const { GET } = await import('./route')

describe('GET /auth/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
