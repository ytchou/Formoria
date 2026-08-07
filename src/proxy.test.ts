import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Boundary mocks only: the origin guard runs near the top of `proxy()`, but a
 * request that PASSES the guard keeps falling through to the rate limiter
 * (Redis) and the Supabase session refresh (Auth server). Both are system
 * edges; everything between them — pathname normalization, the exempt-path
 * predicate, the guard itself — runs for real.
 *
 * The rate limiter is stubbed here. Supabase is NOT mocked — mocking it is
 * forbidden by `scripts/check-test-boundaries.mjs`. Instead every test below
 * blanks `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`, which
 * makes `refreshSupabaseSession` return the response untouched: no client is
 * constructed and no Auth call is made, regardless of what the ambient
 * environment happens to have configured. The session refresh is downstream of
 * the origin guard, so it cannot affect any assertion in this file.
 */
vi.mock('@/lib/security/crawler-telemetry', () => ({
  recordCrawlerHit: vi.fn(),
}))

vi.mock('@/lib/security/rate-limiter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/rate-limiter')>()
  return {
    ...actual,
    checkRateLimit: async () => null,
    checkSoftRateLimit: async () => false,
  }
})

const { proxy, isOriginGuardExempt, ORIGIN_GUARD_EXEMPT_PATHS } = await import('@/proxy')

const EDGE_SECRET = 'cf-edge-9f3b7c21ae4d48e0b6a15c73d2f0e884'
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

function requestFor(pathname: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(`https://formoria.com${pathname}`), {
    headers: { 'user-agent': BROWSER_UA, ...headers },
  })
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('origin guard exempt paths', () => {
  it('exempts /api/health and everything beneath it — Railway probes it from inside its own network with no edge header, so a 403 here would fail every deploy health check forever, including the deploy that would fix it', () => {
    expect(isOriginGuardExempt('/api/health')).toBe(true)
    expect(isOriginGuardExempt('/api/health/deep')).toBe(true)
  })

  it('exempts every /api/cron/ route by prefix', () => {
    expect(isOriginGuardExempt('/api/cron/refresh-brand-metrics')).toBe(true)
    expect(isOriginGuardExempt('/api/cron/')).toBe(true)
  })

  it('exempts /api/internal/revalidate-brands exactly, leaving the rest of /api/internal/ guarded', () => {
    expect(isOriginGuardExempt('/api/internal/revalidate-brands')).toBe(true)
    expect(isOriginGuardExempt('/api/internal/revalidate-brands/extra')).toBe(false)
    expect(isOriginGuardExempt('/api/internal/purge-cache')).toBe(false)
    expect(isOriginGuardExempt('/api/internal')).toBe(false)
  })

  it('does not exempt ordinary application paths', () => {
    expect(isOriginGuardExempt('/brands/kinship-goods')).toBe(false)
    expect(isOriginGuardExempt('/api/admin/brands')).toBe(false)
    expect(isOriginGuardExempt('/')).toBe(false)
  })

  it('publishes the three exempt entries as a named constant', () => {
    expect(ORIGIN_GUARD_EXEMPT_PATHS).toHaveLength(3)
  })
})

describe('a request arriving at the origin in production', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('CF_ORIGIN_SECRET', EDGE_SECRET)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is served when it carries the edge credential in the new x-formoria-edge header', async () => {
    const response = await proxy(requestFor('/api/admin/brands', { 'x-formoria-edge': EDGE_SECRET }))
    expect(response.status).not.toBe(403)
  })

  it('is still served when it carries the edge credential in the legacy x-origin-verify header — the fallback that keeps production alive until the Cloudflare rule ships', async () => {
    const response = await proxy(requestFor('/api/admin/brands', { 'x-origin-verify': EDGE_SECRET }))
    expect(response.status).not.toBe(403)
  })

  it('is rejected when the new header is present but wrong, even if the legacy header is correct — the new header must win outright, or the zone-wide transform rule would override the migration', async () => {
    const response = await proxy(
      requestFor('/api/admin/brands', {
        'x-formoria-edge': 'cf-edge-stale-rotated-value',
        'x-origin-verify': EDGE_SECRET,
      }),
    )
    expect(response.status).toBe(403)
    await expect(response.text()).resolves.toBe('Forbidden')
  })

  it('is rejected on a non-exempt path when it carries no credential at all', async () => {
    const response = await proxy(requestFor('/api/admin/brands'))
    expect(response.status).toBe(403)
  })

  it('reaches /api/health with no credential — Railway health probes originate inside the private network and never pass through Cloudflare, so a 403 here bricks every future deploy', async () => {
    const response = await proxy(requestFor('/api/health'))
    expect(response.status).not.toBe(403)
  })

  it('reaches a pg_cron job route with no edge credential — cron callers hit the Railway origin directly and authenticate themselves inside the handler', async () => {
    const response = await proxy(requestFor('/api/cron/refresh-brand-metrics'))
    expect(response.status).not.toBe(403)
  })

  it('reaches /api/internal/revalidate-brands with no edge credential', async () => {
    const response = await proxy(requestFor('/api/internal/revalidate-brands'))
    expect(response.status).not.toBe(403)
  })

  it('is rejected on the rest of /api/internal/, which is deliberately not exempt', async () => {
    const response = await proxy(requestFor('/api/internal/purge-cache'))
    expect(response.status).toBe(403)
  })
})

describe('the origin guard when it is not configured to run', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('lets an uncredentialed request through when CF_ORIGIN_SECRET is unset', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('CF_ORIGIN_SECRET', '')
    const response = await proxy(requestFor('/api/admin/brands'))
    expect(response.status).not.toBe(403)
  })

  it('lets an uncredentialed request through outside production, so local development needs no edge header', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('CF_ORIGIN_SECRET', EDGE_SECRET)
    const response = await proxy(requestFor('/api/admin/brands'))
    expect(response.status).not.toBe(403)
  })
})
