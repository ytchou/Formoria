import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  checkAllServices,
  type ServiceHealthResult,
} from './health-checks'
import type { createServiceClient as createServiceClientType } from '@/lib/supabase/server'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/lib/services/sentry', () => ({
  resolveSentryProject: vi.fn().mockResolvedValue({ org: 'test-org', project: 'test-project' }),
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
    process.env.SENTRY_AUTH_TOKEN = 'test-token'
    process.env.RESEND_API_KEY = 're_test'
    process.env.TURNSTILE_SECRET_KEY = 'test-secret'
    process.env.NEXT_PUBLIC_SITE_URL = 'https://test.formoria.com'
    process.env.UPSTASH_REDIS_REST_URL = 'https://test-upstash.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-upstash-token'
    process.env.SERPER_API_KEY = 'test-serper-key'
    process.env.DEEPSEEK_API_KEY = 'test-deepseek-key'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns an array of 9 ServiceHealthResults', async () => {
    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockReturnValue(asMockServiceClient(mockSupabase()))
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('google.serper.dev')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ credits: 2500 }),
        })
      }

      if (url.includes('deepseek.com')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            is_available: true,
            balance_infos: [{ currency: 'USD', total_balance: '5.00' }],
          }),
        })
      }

      return Promise.resolve({ ok: true, json: async () => ({}) })
    })

    const results: ServiceHealthResult[] = await checkAllServices()

    expect(results).toHaveLength(10)
    const services = results.map((r) => r.service)
    expect(services).toContain('Supabase')
    expect(services).toContain('Sentry')
    expect(services).toContain('Resend')
    expect(services).toContain('Turnstile')
    expect(services).toContain('Tally')
    expect(services).toContain('Railway')
    expect(services).toContain('Upstash Redis')
    expect(services).toContain('Serper')
    expect(services).toContain('DeepSeek')
    expect(services).toContain('OpenAI')
  })

  it('each result has the required ServiceHealthResult shape', async () => {
    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockReturnValue(asMockServiceClient(mockSupabase()))
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('google.serper.dev')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ credits: 2500 }),
        })
      }

      if (url.includes('deepseek.com')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            is_available: true,
            balance_infos: [{ currency: 'USD', total_balance: '5.00' }],
          }),
        })
      }

      return Promise.resolve({ ok: true, json: async () => ({}) })
    })

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

  it('returns unconfigured for Sentry when SENTRY_AUTH_TOKEN is missing', async () => {
    delete process.env.SENTRY_AUTH_TOKEN
    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockReturnValue(asMockServiceClient(mockSupabase()))
    fetchMock.mockResolvedValue({ ok: true })

    const results = await checkAllServices()
    const sentry = results.find((r) => r.service === 'Sentry')
    expect(sentry?.status).toBe('unconfigured')
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
      ['Sentry', 'Resend', 'Turnstile', 'Railway', 'Upstash Redis'].includes(r.service)
    )
    for (const svc of fetchServices) {
      expect(svc.status).toBe('down')
    }
  })

  describe('checkUpstashRedis', () => {
    it('returns unconfigured when UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN env vars missing', async () => {
      const { createServiceClient } = await import('@/lib/supabase/server')
      vi.mocked(createServiceClient).mockReturnValue(asMockServiceClient(mockSupabase()))
      fetchMock.mockResolvedValue({ ok: true })

      delete process.env.UPSTASH_REDIS_REST_URL
      const results = await checkAllServices()
      const upstashRedis = results.find((r) => r.service === 'Upstash Redis')
      expect(upstashRedis?.status).toBe('unconfigured')

      process.env.UPSTASH_REDIS_REST_URL = 'https://test-upstash.upstash.io'
      delete process.env.UPSTASH_REDIS_REST_TOKEN
      const tokenResults = await checkAllServices()
      const tokenUpstashRedis = tokenResults.find((r) => r.service === 'Upstash Redis')
      expect(tokenUpstashRedis?.status).toBe('unconfigured')
    })

    it('returns healthy when PING succeeds under 500ms', async () => {
      const { createServiceClient } = await import('@/lib/supabase/server')
      vi.mocked(createServiceClient).mockReturnValue(asMockServiceClient(mockSupabase()))
      fetchMock.mockImplementation((url: string) =>
        url.includes('upstash.io') ? Promise.resolve({ ok: true }) : Promise.resolve({ ok: true })
      )

      const results = await checkAllServices()
      const upstashRedis = results.find((r) => r.service === 'Upstash Redis')
      expect(upstashRedis?.status).toBe('healthy')
      expect(upstashRedis?.message).toMatch(/Connected \(\d+ms\)/)
    })

    it('returns degraded when latency is >=500ms', async () => {
      const nowSpy = vi.spyOn(performance, 'now')
      nowSpy.mockReturnValueOnce(0).mockReturnValueOnce(600)
      const { createServiceClient } = await import('@/lib/supabase/server')
      vi.mocked(createServiceClient).mockReturnValue(asMockServiceClient(mockSupabase()))
      fetchMock.mockImplementation((url: string) =>
        url.includes('upstash.io') ? Promise.resolve({ ok: true }) : Promise.resolve({ ok: true })
      )

      const results = await checkAllServices()
      const upstashRedis = results.find((r) => r.service === 'Upstash Redis')
      expect(upstashRedis?.status).toBe('degraded')
      expect(upstashRedis?.message).toMatch(/Connected, high latency \(\d+ms\)/)
      nowSpy.mockRestore()
    })

    it('returns down when fetch throws', async () => {
      const { createServiceClient } = await import('@/lib/supabase/server')
      vi.mocked(createServiceClient).mockReturnValue(asMockServiceClient(mockSupabase()))
      fetchMock.mockImplementation((url: string) =>
        url.includes('upstash.io')
          ? Promise.reject(new Error('Network error'))
          : Promise.resolve({ ok: true })
      )

      const results = await checkAllServices()
      const upstashRedis = results.find((r) => r.service === 'Upstash Redis')
      expect(upstashRedis?.status).toBe('down')
      expect(upstashRedis?.message).toMatch(/Connection error/)
    })
  })

  describe('checkSerper', () => {
    it('returns unconfigured when SERPER_API_KEY is missing', async () => {
      delete process.env.SERPER_API_KEY
      const { createServiceClient } = await import('@/lib/supabase/server')
      vi.mocked(createServiceClient).mockReturnValue(asMockServiceClient(mockSupabase()))
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })

      const results = await checkAllServices()
      const serper = results.find((r) => r.service === 'Serper')

      expect(serper?.status).toBe('unconfigured')
      expect(serper?.message).toBe('SERPER_API_KEY is not configured')
    })

    it('returns healthy when API responds ok', async () => {
      const { createServiceClient } = await import('@/lib/supabase/server')
      vi.mocked(createServiceClient).mockReturnValue(asMockServiceClient(mockSupabase()))
      fetchMock.mockImplementation((url: string) => {
        if (url.includes('google.serper.dev')) {
          return Promise.resolve({ ok: true, json: async () => ({ credits: 2500 }) })
        }
        return Promise.resolve({ ok: true, json: async () => ({}) })
      })

      const results = await checkAllServices()
      const serper = results.find((r) => r.service === 'Serper')

      expect(serper?.status).toBe('healthy')
      expect(serper?.message).toBe('API reachable')
    })

    it('returns down when API returns non-ok response', async () => {
      const { createServiceClient } = await import('@/lib/supabase/server')
      vi.mocked(createServiceClient).mockReturnValue(asMockServiceClient(mockSupabase()))
      fetchMock.mockImplementation((url: string) => {
        if (url.includes('google.serper.dev')) {
          return Promise.resolve({ ok: false, status: 401 })
        }
        return Promise.resolve({ ok: true, json: async () => ({}) })
      })

      const results = await checkAllServices()
      const serper = results.find((r) => r.service === 'Serper')

      expect(serper?.status).toBe('down')
      expect(serper?.message).toBe('API returned 401')
    })
  })

  describe('checkDeepSeek', () => {
    it('returns unconfigured when DEEPSEEK_API_KEY is missing', async () => {
      delete process.env.DEEPSEEK_API_KEY
      const { createServiceClient } = await import('@/lib/supabase/server')
      vi.mocked(createServiceClient).mockReturnValue(asMockServiceClient(mockSupabase()))
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })

      const results = await checkAllServices()
      const deepSeek = results.find((r) => r.service === 'DeepSeek')

      expect(deepSeek?.status).toBe('unconfigured')
      expect(deepSeek?.message).toBe('DEEPSEEK_API_KEY is not configured')
    })

    it('returns healthy with remaining USD balance when API succeeds', async () => {
      const { createServiceClient } = await import('@/lib/supabase/server')
      vi.mocked(createServiceClient).mockReturnValue(asMockServiceClient(mockSupabase()))
      fetchMock.mockImplementation((url: string) => {
        if (url.includes('deepseek.com')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              is_available: true,
              balance_infos: [{ currency: 'USD', total_balance: '5.00' }],
            }),
          })
        }
        return Promise.resolve({ ok: true, json: async () => ({}) })
      })

      const results = await checkAllServices()
      const deepSeek = results.find((r) => r.service === 'DeepSeek')

      expect(deepSeek?.status).toBe('healthy')
      expect(deepSeek?.message).toBe('$5.00 remaining')
    })

    it('returns down when API returns non-ok response', async () => {
      const { createServiceClient } = await import('@/lib/supabase/server')
      vi.mocked(createServiceClient).mockReturnValue(asMockServiceClient(mockSupabase()))
      fetchMock.mockImplementation((url: string) => {
        if (url.includes('deepseek.com')) {
          return Promise.resolve({ ok: false, status: 401 })
        }
        return Promise.resolve({ ok: true, json: async () => ({}) })
      })

      const results = await checkAllServices()
      const deepSeek = results.find((r) => r.service === 'DeepSeek')

      expect(deepSeek?.status).toBe('down')
      expect(deepSeek?.message).toBe('API returned 401')
    })
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
