import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { checkAllServices, type ServiceHealthResult } from './health-checks'
import type { createServiceClient as createServiceClientType } from '@/lib/supabase/server'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const mockSupabase = (error: Error | null = null, data: Record<string, unknown>[] | null = null) => ({
  from: vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      not: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ error, data }),
    }),
  }),
})

type MockServiceClient = ReturnType<typeof createServiceClientType>
const asMockServiceClient = (client: ReturnType<typeof mockSupabase>) =>
  client as unknown as MockServiceClient

describe('checkAllServices', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.SENTRY_ORG = 'test-org'
    process.env.SENTRY_PROJECT = 'test-project'
    process.env.SENTRY_API_TOKEN = 'test-token'
    process.env.RESEND_API_KEY = 're_test'
    process.env.TURNSTILE_SECRET_KEY = 'test-secret'
    process.env.RENDER_API_KEY = 'test-render-key'
    process.env.BROWSERLESS_URL = 'https://chrome.browserless.io'
    process.env.NEXT_PUBLIC_SITE_URL = 'https://test.formoria.com'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns an array of 7 ServiceHealthResults', async () => {
    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockReturnValue(asMockServiceClient(mockSupabase()))
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })

    const results: ServiceHealthResult[] = await checkAllServices()

    expect(results).toHaveLength(7)
    const services = results.map((r) => r.service)
    expect(services).toContain('Supabase')
    expect(services).toContain('Sentry')
    expect(services).toContain('Resend')
    expect(services).toContain('Turnstile')
    expect(services).toContain('Tally')
    expect(services).toContain('Browserless')
    expect(services).toContain('Railway')
  })

  it('each result has the required ServiceHealthResult shape', async () => {
    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockReturnValue(asMockServiceClient(mockSupabase()))
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })

    const results = await checkAllServices()

    for (const result of results) {
      expect(result).toHaveProperty('service')
      expect(result).toHaveProperty('status')
      expect(result).toHaveProperty('message')
      expect(result).toHaveProperty('checkedAt')
      expect(['healthy', 'degraded', 'down', 'unconfigured']).toContain(result.status)
    }
  })

  it('returns down for Supabase when query returns an error', async () => {
    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockReturnValue(
      asMockServiceClient(mockSupabase(new Error('connection failed')))
    )
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })

    const results = await checkAllServices()
    const supabase = results.find((r) => r.service === 'Supabase')
    expect(supabase?.status).toBe('down')
  })

  it('returns unconfigured for Sentry when SENTRY_API_TOKEN is missing', async () => {
    delete process.env.SENTRY_API_TOKEN
    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockReturnValue(asMockServiceClient(mockSupabase()))
    fetchMock.mockResolvedValue({ ok: true })

    const results = await checkAllServices()
    const sentry = results.find((r) => r.service === 'Sentry')
    expect(sentry?.status).toBe('unconfigured')
  })

  it('returns unconfigured for Browserless when RENDER_API_KEY is missing', async () => {
    delete process.env.RENDER_API_KEY
    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockReturnValue(asMockServiceClient(mockSupabase()))
    fetchMock.mockResolvedValue({ ok: true })

    const results = await checkAllServices()
    const browserless = results.find((r) => r.service === 'Browserless')
    expect(browserless?.status).toBe('unconfigured')
  })

  it('returns down for Resend when fetch returns non-ok response', async () => {
    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockReturnValue(asMockServiceClient(mockSupabase()))
    fetchMock.mockImplementation((url: string) =>
      url.includes('resend.com') ? Promise.resolve({ ok: false }) : Promise.resolve({ ok: true })
    )

    const results = await checkAllServices()
    const resend = results.find((r) => r.service === 'Resend')
    expect(resend?.status).toBe('down')
  })

  it('returns down for any service when fetch throws (network error)', async () => {
    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockReturnValue(asMockServiceClient(mockSupabase()))
    fetchMock.mockRejectedValue(new Error('Network error'))

    const results = await checkAllServices()
    const fetchServices = results.filter((r) =>
      ['Sentry', 'Resend', 'Turnstile', 'Browserless', 'Railway'].includes(r.service)
    )
    for (const svc of fetchServices) {
      expect(svc.status).toBe('down')
    }
  })

  describe('checkTally age thresholds', () => {
    const makeRow = (daysAgo: number) => ({
      created_at: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    })

    it('returns healthy when latest Tally submission is less than 30 days old', async () => {
      const { createServiceClient } = await import('@/lib/supabase/server')
      vi.mocked(createServiceClient).mockReturnValue(
        asMockServiceClient(mockSupabase(null, [makeRow(10)]))
      )
      fetchMock.mockResolvedValue({ ok: true })

      const results = await checkAllServices()
      const tally = results.find((r) => r.service === 'Tally')
      expect(tally?.status).toBe('healthy')
    })

    it('returns degraded when latest Tally submission is 30-90 days old', async () => {
      const { createServiceClient } = await import('@/lib/supabase/server')
      vi.mocked(createServiceClient).mockReturnValue(
        asMockServiceClient(mockSupabase(null, [makeRow(60)]))
      )
      fetchMock.mockResolvedValue({ ok: true })

      const results = await checkAllServices()
      const tally = results.find((r) => r.service === 'Tally')
      expect(tally?.status).toBe('degraded')
    })

    it('returns down when latest Tally submission is older than 90 days', async () => {
      const { createServiceClient } = await import('@/lib/supabase/server')
      vi.mocked(createServiceClient).mockReturnValue(
        asMockServiceClient(mockSupabase(null, [makeRow(100)]))
      )
      fetchMock.mockResolvedValue({ ok: true })

      const results = await checkAllServices()
      const tally = results.find((r) => r.service === 'Tally')
      expect(tally?.status).toBe('down')
    })

    it('returns healthy when no Tally submissions exist (no rows)', async () => {
      const { createServiceClient } = await import('@/lib/supabase/server')
      vi.mocked(createServiceClient).mockReturnValue(asMockServiceClient(mockSupabase(null, [])))
      fetchMock.mockResolvedValue({ ok: true })

      const results = await checkAllServices()
      const tally = results.find((r) => r.service === 'Tally')
      expect(tally?.status).toBe('healthy')
    })
  })
})
