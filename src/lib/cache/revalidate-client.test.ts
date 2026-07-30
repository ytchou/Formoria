import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { requestPublicBrandRevalidation } from './revalidate-client'

const originalFetch = globalThis.fetch
const originalRailwayUrl = process.env.FORMORIA_RAILWAY_URL
const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL
const originalSecret = process.env.ORIGIN_SECRET

const fetchMock = vi.fn()

function okResponse() {
  return { ok: true, status: 200 } as unknown as Response
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(okResponse())
  globalThis.fetch = fetchMock as unknown as typeof fetch
  process.env.FORMORIA_RAILWAY_URL = 'https://formoria.up.railway.app/'
  process.env.NEXT_PUBLIC_SITE_URL = 'https://formoria.com/'
  process.env.ORIGIN_SECRET = 'test-secret'
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalRailwayUrl === undefined) delete process.env.FORMORIA_RAILWAY_URL
  else process.env.FORMORIA_RAILWAY_URL = originalRailwayUrl
  if (originalSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
  else process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl
  if (originalSecret === undefined) delete process.env.ORIGIN_SECRET
  else process.env.ORIGIN_SECRET = originalSecret
  vi.restoreAllMocks()
})

describe('requestPublicBrandRevalidation', () => {
  it('makes no network call for an empty or whitespace-only slug list', async () => {
    await expect(requestPublicBrandRevalidation([])).resolves.toEqual({
      ok: true,
      reason: 'no-slugs',
    })
    await expect(requestPublicBrandRevalidation(['', '   '])).resolves.toEqual({
      ok: true,
      reason: 'no-slugs',
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports not-configured without fetching when ORIGIN_SECRET is missing', async () => {
    delete process.env.ORIGIN_SECRET

    await expect(requestPublicBrandRevalidation(['niizo'])).resolves.toEqual({
      ok: false,
      reason: 'not-configured',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports not-configured without fetching when neither base URL is set', async () => {
    delete process.env.FORMORIA_RAILWAY_URL
    delete process.env.NEXT_PUBLIC_SITE_URL

    await expect(requestPublicBrandRevalidation(['niizo'])).resolves.toEqual({
      ok: false,
      reason: 'not-configured',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('prefers the Railway origin over the Cloudflare-fronted public host', async () => {
    await expect(requestPublicBrandRevalidation(['niizo'])).resolves.toEqual({ ok: true })

    const [url] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://formoria.up.railway.app/api/internal/revalidate-brands')
  })

  it('falls back to NEXT_PUBLIC_SITE_URL for local dev, where there is no Cloudflare', async () => {
    delete process.env.FORMORIA_RAILWAY_URL

    await expect(requestPublicBrandRevalidation(['niizo'])).resolves.toEqual({ ok: true })

    const [url] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://formoria.com/api/internal/revalidate-brands')
  })

  it('posts de-duplicated slugs to the trailing-slash-stripped endpoint', async () => {
    await expect(
      requestPublicBrandRevalidation(['niizo', ' niizo ', 'kiln', '']),
    ).resolves.toEqual({ ok: true })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://formoria.up.railway.app/api/internal/revalidate-brands')
    expect(init.method).toBe('POST')
    expect(init.headers['x-origin-verify']).toBe('test-secret')
    expect(init.headers['content-type']).toBe('application/json')
    expect(init.cache).toBe('no-store')
    expect(JSON.parse(init.body)).toEqual({ slugs: ['niizo', 'kiln'] })
  })

  it('resolves ok: false on a non-OK response instead of throwing', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 } as unknown as Response)

    await expect(requestPublicBrandRevalidation(['niizo'])).resolves.toEqual({
      ok: false,
      reason: 'http-503',
    })
  })

  it('resolves ok: false when fetch rejects instead of throwing', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))

    const result = await requestPublicBrandRevalidation(['niizo'])

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('network down')
  })
})
