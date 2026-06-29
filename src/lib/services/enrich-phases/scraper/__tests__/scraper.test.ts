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
    expect(result.galleryImageUrls).toContain(
      'https://mybrand.com.tw/product2.jpg'
    )
    expect(result.galleryImageUrls).not.toContain(
      'https://mybrand.com.tw/icon.png'
    )
    expect(result.galleryImageUrls).toHaveLength(2)
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
