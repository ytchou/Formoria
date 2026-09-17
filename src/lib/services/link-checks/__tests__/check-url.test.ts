import { describe, expect, it, vi } from 'vitest'

import { BROWSER_UA, RETRY_ON, checkUrl } from '../check-url'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(
  responses: Array<{ status: number; url?: string }>,
): typeof fetch {
  let call = 0
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const resp = responses[call] ?? { status: 500 }
    call += 1
    return {
      status: resp.status,
      url: resp.url ?? String(_url),
      ok: resp.status >= 200 && resp.status < 300,
      headers: new Headers(),
      text: async () => '',
    } as unknown as Response
  }) as unknown as typeof fetch
}

function throwingFetch(errors: Array<Error | null>): typeof fetch {
  let call = 0
  return vi.fn(async () => {
    const err = errors[call]
    call += 1
    if (err) throw err
    return { status: 200, url: 'https://example.com', ok: true } as unknown as Response
  }) as unknown as typeof fetch
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkUrl', () => {
  it('does HEAD then GET on 402/404/405/410/501 with a browser user agent', async () => {
    for (const retryStatus of [402, 404, 405, 410, 501]) {
      const fetchFn = mockFetch([
        { status: retryStatus },
        { status: 200 },
      ])

      const result = await checkUrl('https://example.com/page', fetchFn)
      expect(result.status).toBe('ok')
      expect(result.statusCode).toBe(200)

      // Verify two calls: HEAD then GET
      expect(fetchFn).toHaveBeenCalledTimes(2)
      const [firstCall, secondCall] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls
      expect(firstCall[1]).toMatchObject({
        method: 'HEAD',
        headers: { 'User-Agent': BROWSER_UA },
      })
      expect(secondCall[1]).toMatchObject({
        method: 'GET',
        headers: { 'User-Agent': BROWSER_UA },
      })
    }
  })

  it('confirms RETRY_ON matches the set from link-health.ts:133', () => {
    expect([...RETRY_ON].sort()).toEqual([402, 404, 405, 410, 501])
  })

  it('returns ok on a successful HEAD without retrying', async () => {
    const fetchFn = mockFetch([{ status: 200 }])
    const result = await checkUrl('https://example.com', fetchFn)
    expect(result).toEqual({
      status: 'ok',
      statusCode: 200,
      resolvedUrl: 'https://example.com',
    })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('classifies 403 as blocked', async () => {
    const fetchFn = mockFetch([{ status: 403 }])
    const result = await checkUrl('https://blocked.example.com', fetchFn)
    expect(result.status).toBe('blocked')
    expect(result.statusCode).toBe(403)
  })

  it('classifies 429 as blocked', async () => {
    const fetchFn = mockFetch([{ status: 429 }])
    const result = await checkUrl('https://ratelimited.example.com', fetchFn)
    expect(result.status).toBe('blocked')
  })

  it('falls back to GET when HEAD throws, and succeeds', async () => {
    const fetchFn = throwingFetch([new Error('HEAD failed'), null])
    const result = await checkUrl('https://example.com', fetchFn)
    expect(result.status).toBe('ok')
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('returns broken when both HEAD and GET throw', async () => {
    const fetchFn = throwingFetch([
      new Error('HEAD failed'),
      new Error('GET failed'),
    ])
    const result = await checkUrl('https://down.example.com', fetchFn)
    expect(result).toMatchObject({
      status: 'broken',
      statusCode: null,
      resolvedUrl: null,
    })
  })

  it('returns broken for private/internal URLs without making a request', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch
    const result = await checkUrl('http://localhost:3000', fetchFn)
    expect(result.status).toBe('broken')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('captures the resolved URL after redirects', async () => {
    const fetchFn = mockFetch([
      { status: 301, url: 'https://example.com/new-page' },
    ])
    const result = await checkUrl('https://example.com/old-page', fetchFn)
    // 301 is < 400, so it's "ok" (redirect was followed)
    expect(result.resolvedUrl).toBe('https://example.com/new-page')
  })

  it('classifies 500 as broken', async () => {
    const fetchFn = mockFetch([{ status: 500 }])
    const result = await checkUrl('https://broken.example.com', fetchFn)
    expect(result.status).toBe('broken')
    expect(result.statusCode).toBe(500)
  })
})
