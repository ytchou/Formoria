import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock fetch globally — probeStatic uses native fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock isPrivateUrl
vi.mock('@/lib/url', () => ({
  isPrivateUrl: vi.fn((url: string) => {
    try {
      const parsed = new URL(url)
      return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
    } catch {
      return true
    }
  }),
}))

import { parseInstagramFollowers, probeStatic } from '../gather'

function htmlResponse(title: string, description: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <meta name="description" content="${description}">
</head>
<body><p>Hello</p></body>
</html>`
}

describe('probeStatic', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('probe_static_extracts_title_and_description', async () => {
    const html = htmlResponse('My Brand', 'A great brand description')
    mockFetch.mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    )

    const results = await probeStatic(['https://example.com'])
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      url: 'https://example.com',
      title: 'My Brand',
      description: 'A great brand description',
      status: 200,
    })
  })

  it('probe_static_handles_timeout', async () => {
    mockFetch.mockImplementation(
      () => new Promise((_resolve, reject) => {
        setTimeout(() => reject(new DOMException('The operation was aborted', 'AbortError')), 10)
      }),
    )

    const results = await probeStatic(['https://slow.example.com'], { timeout: 50 })
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      url: 'https://slow.example.com',
    })
    // Should NOT have a successful status
    expect(results[0].title).toBeUndefined()
  })

  it('probe_static_respects_fetch_guards', async () => {
    // Private/localhost URLs should be rejected
    const results = await probeStatic(['http://127.0.0.1:8080/admin', 'https://example.com'])

    // The private URL is skipped (still appears in results but with no data)
    const privateResult = results.find((r) => r.url === 'http://127.0.0.1:8080/admin')
    expect(privateResult).toBeDefined()
    expect(privateResult!.title).toBeUndefined()
    expect(privateResult!.status).toBeUndefined()
  })

  it('probe_static_detects_platform_from_url', async () => {
    const html = htmlResponse('IG Page', 'Instagram bio')
    mockFetch.mockResolvedValue(
      new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }),
    )

    const results = await probeStatic(['https://www.instagram.com/mybrand'])
    expect(results[0].platform).toBe('instagram')
  })

  it('probe_static_handles_non_200_status', async () => {
    mockFetch.mockResolvedValue(
      new Response('Not Found', { status: 404 }),
    )

    const results = await probeStatic(['https://example.com/missing'])
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe(404)
    // Title/description not extracted from non-200 responses
    expect(results[0].title).toBeUndefined()
  })

  it('probe_static_handles_multiple_urls', async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(htmlResponse('Brand A', 'Description A'), {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(htmlResponse('Brand B', 'Description B'), {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      )

    const results = await probeStatic([
      'https://brand-a.com',
      'https://brand-b.com',
    ])
    expect(results).toHaveLength(2)
    expect(results[0].title).toBe('Brand A')
    expect(results[1].title).toBe('Brand B')
  })

  it('probe_static_returns_empty_for_empty_input', async () => {
    const results = await probeStatic([])
    expect(results).toHaveLength(0)
  })

  it('probe_static_extracts_og_title_when_no_title_tag', async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta property="og:title" content="OG Title">
  <meta property="og:description" content="OG Description">
</head>
<body></body>
</html>`
    mockFetch.mockResolvedValue(
      new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }),
    )

    const results = await probeStatic(['https://example.com'])
    expect(results[0].title).toBe('OG Title')
    expect(results[0].description).toBe('OG Description')
  })
})

describe('parseInstagramFollowers', () => {
  it('parse_instagram_followers_handles_comma_k_and_m_formats', () => {
    expect(parseInstagramFollowers('8,014 Followers, 1 Following')).toBe(8014)
    expect(parseInstagramFollowers('1.6K Followers')).toBe(1600)
    expect(parseInstagramFollowers('12M Followers')).toBe(12_000_000)
    expect(parseInstagramFollowers('0 Followers')).toBe(0)
    expect(parseInstagramFollowers('See Instagram photos')).toBeUndefined()
    expect(parseInstagramFollowers(undefined)).toBeUndefined()
  })
})

describe('probeStatic instagram followers', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('probe_static_sets_instagram_followers_from_og_description', async () => {
    const description =
      '8,014 Followers, 1 Following, 42 Posts - See Instagram photos and videos'
    mockFetch.mockResolvedValue(
      new Response(
        `<html><head><meta property="og:description" content="${description}"></head><body></body></html>`,
        { status: 200, headers: { 'content-type': 'text/html' } },
      ),
    )

    const results = await probeStatic(['https://www.instagram.com/mybrand'])
    expect(results[0].instagramFollowers).toBe(8014)
  })

  it('probe_static_leaves_followers_unset_for_a_non_instagram_url', async () => {
    mockFetch.mockResolvedValue(
      new Response(
        '<html><head><meta name="description" content="8,014 Followers"></head><body></body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      ),
    )

    const results = await probeStatic(['https://mybrand.com'])
    expect(results[0].instagramFollowers).toBeUndefined()
  })

  it('probe_static_detects_threads_com_platform', async () => {
    mockFetch.mockResolvedValue(
      new Response(htmlResponse('Threads Page', 'Threads bio'), {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    )

    const results = await probeStatic(['https://www.threads.com/@x'])
    expect(results[0].platform).toBe('threads')

    const legacy = await probeStatic(['https://www.threads.net/@x'])
    expect(legacy[0].platform).toBe('threads')
  })
})
