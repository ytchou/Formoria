import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  requestEventRevalidation,
  requestPublicBrandRevalidation,
} from './revalidate-client'

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

/**
 * Regression guard for the 2026-08-03 approve-ready run: 415 slugs went out in
 * one POST, the route rejected the whole batch with http-400 "Too many slugs",
 * and 415 brands stayed stale on the public site while the run reported
 * success. MAX_SLUGS in app/api/internal/revalidate-brands/route.ts caps
 * `slugs` and `events` COMBINED at 200 — if that number ever drops, these tests
 * must move with it.
 */
describe('chunking at the route cap', () => {
  function slugList(count: number): string[] {
    return Array.from({ length: count }, (_, index) => `brand-${index}`)
  }

  function postedSlugs(callIndex: number, key: 'slugs' | 'events'): string[] {
    const [, init] = fetchMock.mock.calls[callIndex] as [string, RequestInit]
    return JSON.parse(init.body as string)[key] as string[]
  }

  it('sends exactly one request at the 200-slug cap', async () => {
    await expect(
      requestPublicBrandRevalidation(slugList(200)),
    ).resolves.toEqual({ ok: true })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(postedSlugs(0, 'slugs')).toHaveLength(200)
  })

  it('splits 415 slugs into 200/200/15 without dropping or duplicating any', async () => {
    const slugs = slugList(415)

    await expect(requestPublicBrandRevalidation(slugs)).resolves.toEqual({
      ok: true,
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    const chunks = [0, 1, 2].map((index) => postedSlugs(index, 'slugs'))
    expect(chunks.map((chunk) => chunk.length)).toEqual([200, 200, 15])
    expect(chunks.flat()).toEqual(slugs)
  })

  it('chunks events on the same cap', async () => {
    await expect(requestEventRevalidation(slugList(201))).resolves.toEqual({
      ok: true,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(postedSlugs(0, 'events')).toHaveLength(200)
    expect(postedSlugs(1, 'events')).toHaveLength(1)
  })

  it('attempts every chunk after one fails and reports the first failure', async () => {
    // Each caller has already committed its write, so abandoning the remaining
    // chunks would leave strictly more pages stale than finishing the loop.
    fetchMock.mockReset()
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500 } as unknown as Response)
      .mockResolvedValue(okResponse())

    await expect(requestPublicBrandRevalidation(slugList(415))).resolves.toEqual(
      { ok: false, reason: 'http-500' },
    )

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('deduplicates before chunking so the cap counts distinct slugs', async () => {
    await expect(
      requestPublicBrandRevalidation([...slugList(200), ...slugList(200)]),
    ).resolves.toEqual({ ok: true })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
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

describe('requestEventRevalidation', () => {
  it('reports not-configured without fetching when ORIGIN_SECRET is missing', async () => {
    delete process.env.ORIGIN_SECRET

    await expect(requestEventRevalidation(['spring-craft-fair'])).resolves.toEqual({
      ok: false,
      reason: 'not-configured',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts de-duplicated event slugs under the events key', async () => {
    await expect(
      requestEventRevalidation([
        'spring-craft-fair',
        ' spring-craft-fair ',
        'kiln-open-studio',
        '',
        '   ',
      ]),
    ).resolves.toEqual({ ok: true })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://formoria.up.railway.app/api/internal/revalidate-brands')
    expect(init.method).toBe('POST')
    expect(init.headers['x-origin-verify']).toBe('test-secret')
    expect(init.headers['content-type']).toBe('application/json')
    expect(init.cache).toBe('no-store')
    expect(JSON.parse(init.body)).toEqual({
      events: ['spring-craft-fair', 'kiln-open-studio'],
    })
  })

  it('makes no network call for an empty or whitespace-only slug list', async () => {
    await expect(requestEventRevalidation([])).resolves.toEqual({
      ok: true,
      reason: 'no-slugs',
    })
    await expect(requestEventRevalidation(['', '  '])).resolves.toEqual({
      ok: true,
      reason: 'no-slugs',
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('resolves ok: false when fetch rejects instead of throwing', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))

    const result = await requestEventRevalidation(['spring-craft-fair'])

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('network down')
  })
})
