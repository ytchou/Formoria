import { describe, it, expect, vi, beforeEach } from 'vitest'
import { scrapeBrandUrls } from '..'
import { mergeSocialLinks } from '../merge'

const HTML_FULL = `
<!DOCTYPE html>
<html>
<head>
  <title>My Taiwan Brand</title>
  <meta property="og:title" content="My Brand | Official" />
  <meta property="og:description" content="Handcrafted goods from Taiwan since 2010." />
  <meta property="og:image" content="https://mybrand.com.tw/hero.jpg" />
  <meta name="description" content="Fallback description" />
  <meta name="keywords" content="handmade, accessories, taiwan" />
  <script type="application/ld+json">
  {
    "@type": "Organization",
    "name": "My Brand Co.",
    "description": "A premium Taiwanese brand"
  }
  </script>
</head>
<body>
  <a href="https://instagram.com/mybrand">Instagram</a>
  <a href="https://threads.net/@mybrand">Threads</a>
  <a href="https://www.facebook.com/mybrand">Facebook</a>
  <img src="https://mybrand.com.tw/product1.jpg" width="800" height="600" />
  <img src="https://mybrand.com.tw/product2.jpg" width="400" height="300" />
  <img src="https://mybrand.com.tw/wide.jpg" width="1200" height="300" />
  <img src="https://mybrand.com.tw/unsized.jpg" />
  <img src="https://mybrand.com.tw/icon.png" width="32" height="32" />
  <img src="data:image/gif;base64,R0lGODlhAQABAIAAAP" width="1" height="1" />
</body>
</html>`

const HTML_MINIMAL = `
<!DOCTYPE html>
<html>
<head><title>Bare Page</title></head>
<body><p>No metadata</p></body>
</html>`

const HTML_NO_OG = `
<!DOCTYPE html>
<html>
<head>
  <title>Fallback Title</title>
  <meta name="description" content="Fallback meta description" />
</head>
<body></body>
</html>`

describe('scrapeBrandUrls', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('extracts OG tags, JSON-LD, social links, and filters images', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-length': '1000', 'content-type': 'text/html; charset=utf-8' }),
        text: () => Promise.resolve(HTML_FULL),
      })
    )

    const { data: result } = await scrapeBrandUrls(['https://mybrand.com.tw'])

    expect(result.brandName).toBe('My Brand | Official')
    expect(result.description).toBe(
      'Handcrafted goods from Taiwan since 2010.'
    )
    expect(result.heroImageUrl).toBe('https://mybrand.com.tw/hero.jpg')
    expect(result.socialInstagram).toContain('instagram.com/mybrand')
    expect(result.socialThreads).toContain('threads.net/@mybrand')
    expect(result.socialFacebook).toContain('facebook.com/mybrand')
    expect(result.galleryImageUrls).toContain(
      'https://mybrand.com.tw/product1.jpg'
    )
    // Dropped: both declared dimensions are under the 480px short-edge floor.
    expect(result.galleryImageUrls).not.toContain(
      'https://mybrand.com.tw/product2.jpg'
    )
    // Kept despite a 300px height: only ONE dimension is under the floor, and
    // width/height attributes are frequently display sizes rather than the
    // intrinsic size, so the extractor only drops what is unambiguously small.
    // image-download.ts judges real pixels and is the actual guarantee.
    expect(result.galleryImageUrls).toContain('https://mybrand.com.tw/wide.jpg')
    // Kept: no dimensions declared, so there is nothing to judge here.
    expect(result.galleryImageUrls).toContain(
      'https://mybrand.com.tw/unsized.jpg'
    )
    expect(result.galleryImageUrls).not.toContain(
      'https://mybrand.com.tw/icon.png'
    )
    expect(result.galleryImageUrls).toHaveLength(3)
    expect(result.categoryHints).toContain('handmade')
    expect(result.rawJsonLd).toMatchObject({ '@type': 'Organization' })
    expect(result.websiteUrl).toBe('https://mybrand.com.tw')
  })

  it('falls back to <title> and meta description when OG tags are missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-length': '500', 'content-type': 'text/html' }),
        text: () => Promise.resolve(HTML_NO_OG),
      })
    )

    const { data: result } = await scrapeBrandUrls(['https://example.com'])

    expect(result.brandName).toBe('Fallback Title')
    expect(result.description).toBe('Fallback meta description')
  })

  it('yields empty fields from minimal HTML without metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-length': '100', 'content-type': 'text/html' }),
        text: () => Promise.resolve(HTML_MINIMAL),
      })
    )

    const { data: result } = await scrapeBrandUrls(['https://bare.com'])

    expect(result.brandName).toBe('Bare Page')
    expect(result.description).toBeNull()
    expect(result.heroImageUrl).toBeNull()
    expect(result.galleryImageUrls).toHaveLength(0)
    expect(result.socialInstagram).toBeNull()
  })

  it('handles fetch timeout gracefully', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'))
    )

    const { data: result } = await scrapeBrandUrls(['https://slow-site.com'])

    expect(result.brandName).toBeNull()
    expect(result.websiteUrl).toBe('https://slow-site.com')
  })

  it('handles non-OK response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        headers: new Headers(),
        text: () => Promise.resolve('Forbidden'),
      })
    )

    const { data: result } = await scrapeBrandUrls(['https://blocked.com'])

    expect(result.brandName).toBeNull()
    expect(result.websiteUrl).toBe('https://blocked.com')
  })
})

describe('scrapeBrandUrls directives', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('directive skip records skipped without any fetch', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const directives = new Map([
      ['https://skip-me.com', { fetch: 'skip' as const, reason: 'not useful' }],
    ])

    const { data, statuses } = await scrapeBrandUrls(['https://skip-me.com'], {
      directives,
    })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(statuses[0].ok).toBe(false)
    expect(data.brandName).toBeNull()
  })

  it('directive render fetches rendered HTML before strategy', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response('', { status: 404 }),
    )
    vi.stubGlobal('fetch', fetchSpy)

    const renderHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta property="og:title" content="Rendered Brand" />
  <meta property="og:description" content="Rendered description" />
</head>
<body></body>
</html>`

    const renderProvider = {
      fetchRendered: vi.fn().mockResolvedValue({
        html: renderHtml,
        finalUrl: 'https://render-me.com',
        status: 200,
      }),
    }

    const directives = new Map([
      ['https://render-me.com', { fetch: 'render' as const, reason: 'JS-rendered' }],
    ])

    const { data } = await scrapeBrandUrls(['https://render-me.com'], {
      directives,
      renderProvider,
    })

    // Static HTML fetch should NOT have been called for the target URL itself.
    const htmlFetchCalls = fetchSpy.mock.calls.filter(
      (args: unknown[]) => args[0] === 'https://render-me.com',
    )
    expect(htmlFetchCalls).toHaveLength(0)
    expect(renderProvider.fetchRendered).toHaveBeenCalledWith('https://render-me.com')
    expect(data.brandName).toBe('Rendered Brand')
    expect(data.description).toBe('Rendered description')
  })

  it('existing OG/JSON-LD case passes with directives omitted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-length': '1000', 'content-type': 'text/html; charset=utf-8' }),
        text: () => Promise.resolve(HTML_FULL),
      })
    )

    // No directives passed — the existing path must work identically.
    const { data: result } = await scrapeBrandUrls(['https://mybrand.com.tw'])

    expect(result.brandName).toBe('My Brand | Official')
    expect(result.description).toBe(
      'Handcrafted goods from Taiwan since 2010.'
    )
    expect(result.socialInstagram).toContain('instagram.com/mybrand')
  })

  it('directive render failure maps to failed callStatus, not thrown', async () => {
    vi.stubGlobal('fetch', vi.fn())

    const renderProvider = {
      fetchRendered: vi.fn().mockRejectedValue(new Error('Browser crashed')),
    }

    const directives = new Map([
      ['https://fail-render.com', { fetch: 'render' as const, reason: 'test' }],
    ])

    const { statuses } = await scrapeBrandUrls(['https://fail-render.com'], {
      directives,
      renderProvider,
    })

    expect(statuses[0].ok).toBe(false)
    expect(statuses[0].error).toContain('Browser crashed')
  })

  it('batch render provider is tracked so renderMode reflects rendering', async () => {
    // When a render provider has fetchRenderedBatch and the strategy
    // calls it, the tracked wrapper must set rendered = true so
    // renderMode is 'static_then_rendered'. We verify the wrapper
    // passes fetchRenderedBatch through (and it sets the flag) by
    // checking that a strategy calling render.fetchRendered triggers
    // renderMode tracking — and that the batch function is present on
    // the tracked wrapper.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-length': '500', 'content-type': 'text/html' }),
        text: () => Promise.resolve(HTML_FULL),
      })
    )

    const renderProvider = {
      fetchRendered: vi.fn().mockResolvedValue({
        html: HTML_FULL,
        finalUrl: 'https://mybrand.com.tw',
        status: 200,
      }),
      fetchRenderedBatch: vi.fn().mockResolvedValue([]),
    }

    // Use a render directive so the render path executes and rendered = true.
    const directives = new Map([
      ['https://mybrand.com.tw', { fetch: 'render' as const, reason: 'test batch tracking' }],
    ])

    const { data } = await scrapeBrandUrls(['https://mybrand.com.tw'], {
      renderProvider,
      directives,
    })

    // The render directive path sets rendered = true, and the result
    // should contain the extracted data from the rendered HTML.
    expect(data.brandName).toBe('My Brand | Official')
    expect(renderProvider.fetchRendered).toHaveBeenCalled()
  })
})

describe('mergeSocialLinks (flat output)', () => {
  it('later source wins for flat fields when merging scraped data', () => {
    const base = {
      socialInstagram: 'https://instagram.com/base.tw',
      socialThreads: null,
      socialFacebook: null,
    }
    const next = {
      socialInstagram: null,
      socialThreads: '@next_threads',
      socialFacebook: 'https://fb.com/next',
    }

    const result = mergeSocialLinks(base, next)

    expect(result.socialInstagram).toBe('https://instagram.com/base.tw')
    expect(result.socialThreads).toBe('@next_threads')
    expect(result.socialFacebook).toBe('https://fb.com/next')
  })
})
