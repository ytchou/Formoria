import { describe, expect, it, vi } from 'vitest'
import {
  discoverCatalog,
  extractCatalogRoutes,
  hasProductSignals,
  type CatalogFetch,
} from '../catalog-discovery'
import type { RenderProvider } from '../scraper/render/types'

const productHtml = (
  name: string,
  image = `https://cdn.example/${name}.jpg`,
) => `
  <main><h1>${name}</h1><p>Made in Taiwan.</p></main>
  <meta property="og:image" content="${image}">
`

function fetcherFor(pages: Record<string, string | null>): CatalogFetch {
  return vi.fn(async (url) => ({
    text: pages[url] ?? null,
    status: pages[url] ? 200 : 404,
    error: pages[url] ? null : 'HTTP 404',
  }))
}

describe('catalog discovery', () => {
  it('uses complete static product evidence without rendering', async () => {
    const fetcher = fetcherFor({
      'https://shop.example': '<a href="/products/cup">Cup</a>',
      'https://shop.example/products/cup': productHtml('Ceramic cup'),
    })
    const renderProvider: RenderProvider = { fetchRendered: vi.fn() }
    const result = await discoverCatalog({
      sources: [{ url: 'https://shop.example', channel: 'official' }],
      fetcher,
      renderProvider,
    })
    expect(result.triples).toHaveLength(1)
    expect(result.triples[0]).toMatchObject({
      title: 'Ceramic cup',
      supplier: 'catalog:generic',
    })
    expect(renderProvider.fetchRendered).not.toHaveBeenCalled()
  })

  it('retries rendered HTML once when a reachable static surface has no routes', async () => {
    const fetcher = fetcherFor({
      'https://shop.example': '<main></main>',
      'https://shop.example/products/cup': null,
    })
    const renderProvider: RenderProvider = {
      fetchRendered: vi.fn(async (url) => ({
        html: url.endsWith('/products/cup')
          ? productHtml('Rendered cup')
          : '<a href="/products/cup">Cup</a>',
        finalUrl: url,
        status: 200,
      })),
    }
    const result = await discoverCatalog({
      sources: [{ url: 'https://shop.example', channel: 'official' }],
      fetcher,
      renderProvider,
    })
    expect(result.triples[0]?.title).toBe('Rendered cup')
    expect(renderProvider.fetchRendered).toHaveBeenCalledTimes(2)
  })

  it('classifies a reachable empty static app as render_blocked without a renderer', async () => {
    const result = await discoverCatalog({
      sources: [{ url: 'https://shop.example', channel: 'official' }],
      fetcher: fetcherFor({ 'https://shop.example': '<main></main>' }),
    })
    expect(result.zeroReason).toBe('render_blocked')
  })

  it('stops adaptive channel discovery at 20 complete triples', async () => {
    const links = Array.from(
      { length: 25 },
      (_, index) => `<a href="/products/p${index}">P${index}</a>`,
    ).join('')
    const pages: Record<string, string> = { 'https://shop.example': links }
    for (let index = 0; index < 25; index += 1)
      pages[`https://shop.example/products/p${index}`] = productHtml(
        `P${index}`,
      )
    const fetcher = fetcherFor(pages)
    const result = await discoverCatalog({
      sources: [
        { url: 'https://shop.example', channel: 'official' },
        { url: 'https://pinkoi.com/store/example', channel: 'pinkoi' },
      ],
      fetcher,
    })
    expect(result.triples).toHaveLength(20)
    expect(result.attempts).toHaveLength(1)
    expect(result.attempts[0]?.hydrated).toBe(20)
  })

  it('never hydrates more than 25 unique product pages', async () => {
    const links = Array.from(
      { length: 30 },
      (_, index) => `<a href="/products/p${index}">P${index}</a>`,
    ).join('')
    const pages: Record<string, string> = { 'https://shop.example': links }
    for (let index = 0; index < 30; index += 1)
      pages[`https://shop.example/products/p${index}`] = '<main></main>'
    const result = await discoverCatalog({
      sources: [{ url: 'https://shop.example', channel: 'official' }],
      fetcher: fetcherFor(pages),
      target: 30,
    })
    expect(result.attempts[0]?.hydrated).toBe(25)
  })

  it('continues after an incomplete near-target hydration batch', async () => {
    const links = Array.from(
      { length: 24 },
      (_, index) => `<a href="/products/p${index}">P${index}</a>`,
    ).join('')
    const pages: Record<string, string> = { 'https://shop.example': links }
    for (let index = 0; index < 24; index += 1) {
      pages[`https://shop.example/products/p${index}`] =
        index < 18 || index >= 22 ? productHtml(`P${index}`) : '<main></main>'
    }
    const result = await discoverCatalog({
      sources: [{ url: 'https://shop.example', channel: 'official' }],
      fetcher: fetcherFor(pages),
    })
    expect(result.triples).toHaveLength(20)
    expect(result.attempts[0]?.hydrated).toBe(24)
  })

  it('does not let a cross-store product route enter the owned set', async () => {
    const result = await discoverCatalog({
      sources: [{ url: 'https://shop.example', channel: 'official' }],
      fetcher: fetcherFor({
        'https://shop.example':
          '<a href="https://other.example/products/cup">Cup</a>',
      }),
    })
    expect(result.triples).toEqual([])
    expect(result.attempts[0]?.ownedDetailUrls).toBe(0)
  })

  it('classifies a fully inspectable static empty catalog as no_catalog', async () => {
    const result = await discoverCatalog({
      sources: [{ url: 'https://shop.example', channel: 'official' }],
      fetcher: fetcherFor({
        'https://shop.example':
          '<main>This store does not currently have any products available.</main>',
      }),
    })
    expect(result.zeroReason).toBe('no_catalog')
  })

  it('never reads a platform-wide sitemap for a marketplace storefront', async () => {
    const fetcher = fetcherFor({
      'https://pinkoi.com/store/maria':
        '<main>This seller has no products available right now.</main>',
      'https://pinkoi.com/robots.txt':
        'Sitemap: https://pinkoi.com/platform-sitemap.xml',
      'https://pinkoi.com/platform-sitemap.xml':
        '<urlset><url><loc>https://pinkoi.com/product/other-seller</loc></url></urlset>',
    })
    const result = await discoverCatalog({
      sources: [
        { url: 'https://pinkoi.com/store/maria', channel: 'pinkoi' },
      ],
      fetcher,
    })
    expect(result.triples).toEqual([])
    expect(fetcher).not.toHaveBeenCalledWith(
      'https://pinkoi.com/robots.txt',
      'text',
    )
  })

  it('selects featured products first and round-robins explicit groups', async () => {
    const listing = `
      <li data-category="cups"><a href="/products/cup-1">Cup 1</a></li>
      <li data-category="cups"><a href="/products/cup-2">Cup 2</a></li>
      <li data-category="plates"><a href="/products/plate-1">Plate 1</a></li>
      <li data-featured="true"><a href="/products/featured">Featured</a></li>`
    const pages: Record<string, string> = { 'https://shop.example': listing }
    for (const slug of ['cup-1', 'cup-2', 'plate-1', 'featured']) {
      pages[`https://shop.example/products/${slug}`] = productHtml(slug)
    }
    const result = await discoverCatalog({
      sources: [{ url: 'https://shop.example', channel: 'official' }],
      fetcher: fetcherFor(pages),
    })
    expect(result.triples.map((triple) => triple.title)).toEqual([
      'featured',
      'cup-1',
      'plate-1',
      'cup-2',
    ])
  })

  it('does not turn one failed source into a run-level zero', async () => {
    const result = await discoverCatalog({
      sources: [
        { url: 'https://dead.example', channel: 'official' },
        { url: 'https://shop.example/products/cup', channel: 'official' },
      ],
      fetcher: fetcherFor({
        'https://shop.example/products/cup': productHtml('Recovered cup'),
      }),
    })
    expect(result.triples).toHaveLength(1)
    expect(result.zeroReason).toBeUndefined()
  })
})

describe('hasProductSignals', () => {
  it('detects JSON-LD Product', () => {
    const html =
      '<html><head><script type="application/ld+json">{"@type":"Product","name":"Cup"}</script></head><body></body></html>'
    expect(hasProductSignals(html)).toBe(true)
  })

  it('detects og:type product', () => {
    const html =
      '<html><head><meta property="og:type" content="product"></head><body></body></html>'
    expect(hasProductSignals(html)).toBe(true)
  })

  it('detects product:price:amount', () => {
    const html =
      '<html><head><meta property="product:price:amount" content="299"></head><body></body></html>'
    expect(hasProductSignals(html)).toBe(true)
  })

  it('detects microdata Product', () => {
    const html =
      '<html><body><div itemtype="https://schema.org/Product"><span>Cup</span></div></body></html>'
    expect(hasProductSignals(html)).toBe(true)
  })

  it('returns false for non-product page', () => {
    const html =
      '<html><head><meta property="og:type" content="website"></head><body><p>About us</p></body></html>'
    expect(hasProductSignals(html)).toBe(false)
  })
})

describe('content sampling fallback', () => {
  const sitemapXml = (urls: string[]) =>
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${u}</loc></url>`).join('')}</urlset>`

  const productPageHtml = `<html><head><script type="application/ld+json">{"@type":"Product","name":"Test Product"}</script><meta property="og:image" content="https://cdn.example/test.jpg"></head><body><h1>Test Product</h1><p>A product.</p><img src="https://cdn.example/test.jpg"></body></html>`

  it('content sampling produces triples when regex finds nothing but sitemap has product pages', async () => {
    const sitemapUrls = [
      'https://custom-brand.com/items-123',
      'https://custom-brand.com/items-456',
      'https://custom-brand.com/items-789',
    ]
    const fetcher = fetcherFor({
      'https://custom-brand.com': '<main><h1>Welcome</h1></main>',
      'https://custom-brand.com/sitemap.xml': sitemapXml(sitemapUrls),
      'https://custom-brand.com/items-123': productPageHtml,
      'https://custom-brand.com/items-456': productPageHtml,
      'https://custom-brand.com/items-789': productPageHtml,
    })
    const result = await discoverCatalog({
      sources: [{ url: 'https://custom-brand.com', channel: 'official' }],
      fetcher,
    })
    expect(result.attempts[0]?.contentSamplingOutcome).toBe('usable')
    expect(result.triples.length).toBeGreaterThan(0)
  })

  it('content sampling does not trigger for known-platform sources', async () => {
    const fetcher = fetcherFor({
      'https://store.example':
        '<html><body><script>Shopline.theme={}</script></body></html>',
      'https://store.example/sitemap.xml': sitemapXml([
        'https://store.example/items-1',
        'https://store.example/items-2',
      ]),
      'https://store.example/items-1': productPageHtml,
      'https://store.example/items-2': productPageHtml,
    })
    const result = await discoverCatalog({
      sources: [{ url: 'https://store.example', channel: 'official' }],
      fetcher,
    })
    expect(result.attempts[0]?.contentSamplingOutcome).toBe('not_triggered')
  })

  it('content sampling does not trigger when sitemap is empty', async () => {
    const fetcher = fetcherFor({
      'https://custom-brand.com': '<main><h1>Welcome</h1></main>',
    })
    const result = await discoverCatalog({
      sources: [{ url: 'https://custom-brand.com', channel: 'official' }],
      fetcher,
    })
    expect(result.attempts[0]?.contentSamplingOutcome).toBe('not_triggered')
  })

  it('content sampling records empty when no sampled URL has product signals', async () => {
    const sitemapUrls = [
      'https://custom-brand.com/page-1',
      'https://custom-brand.com/page-2',
      'https://custom-brand.com/page-3',
    ]
    const fetcher = fetcherFor({
      'https://custom-brand.com': '<main><h1>Welcome</h1></main>',
      'https://custom-brand.com/sitemap.xml': sitemapXml(sitemapUrls),
      'https://custom-brand.com/page-1':
        '<html><body><p>Just text</p></body></html>',
      'https://custom-brand.com/page-2':
        '<html><body><p>Just text</p></body></html>',
      'https://custom-brand.com/page-3':
        '<html><body><p>Just text</p></body></html>',
    })
    const result = await discoverCatalog({
      sources: [{ url: 'https://custom-brand.com', channel: 'official' }],
      fetcher,
    })
    expect(result.attempts[0]?.contentSamplingOutcome).toBe('empty')
    expect(result.triples).toHaveLength(0)
  })

  it('content sampling skip filter excludes utility paths', async () => {
    const utilityUrls = [
      'https://custom-brand.com/about',
      'https://custom-brand.com/contact',
      'https://custom-brand.com/cart',
    ]
    const fetcher = fetcherFor({
      'https://custom-brand.com': '<main><h1>Welcome</h1></main>',
      'https://custom-brand.com/sitemap.xml': sitemapXml(utilityUrls),
      'https://custom-brand.com/about': productPageHtml,
      'https://custom-brand.com/contact': productPageHtml,
      'https://custom-brand.com/cart': productPageHtml,
    })
    const result = await discoverCatalog({
      sources: [{ url: 'https://custom-brand.com', channel: 'official' }],
      fetcher,
    })
    // Utility URLs should be filtered out, so none are sampled
    for (const url of utilityUrls) {
      expect(fetcher).not.toHaveBeenCalledWith(url, 'html')
    }
    expect(result.attempts[0]?.contentSamplingOutcome).toBe('empty')
  })
})

describe('specialized catalog parsers', () => {
  it.each([
    ['shopline', '/products/one', '<div data-product-id="1"><a href="/products/one">One</a></div>'],
    ['91app', '/SalePage/Index/91', '<div data-salepageid="91"><a href="/SalePage/Index/91">One</a></div>'],
    ['shop2000', '/product/one', '<div class="product-item"><a href="/product/one">One</a></div>'],
    ['cyberbiz', '/products/one', '<div data-product-id="1"><a href="/products/one">One</a></div>'],
    ['pinkoi', '/product/one', '<div data-product-id="1"><a href="/product/one">One</a></div>'],
    ['shopee', '/product/maria/123', '<div data-sqe="item"><a href="/product/maria/123">One</a></div>'],
    ['myship', '/general/detail/GM123', '<div data-product-id="1"><a href="/general/detail/GM123">One</a></div>'],
  ] as const)('extracts an owned %s detail route', (platform, path, html) => {
    const source =
      platform === 'pinkoi'
        ? 'https://pinkoi.com/store/maria'
        : platform === 'shopee'
          ? 'https://shopee.tw/maria'
          : platform === 'myship'
            ? 'https://myship.7-11.com.tw/general/store/GM123'
            : 'https://shop.example'
    expect(extractCatalogRoutes(html, source, platform)[0]?.url).toBe(
      new URL(path, source).href,
    )
  })
})
