import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockExchangeCodeForSession = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      exchangeCodeForSession: mockExchangeCodeForSession,
    },
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
})
