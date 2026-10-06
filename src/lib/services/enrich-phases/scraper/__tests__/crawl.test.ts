import { describe, it, expect, vi, afterEach } from 'vitest'
import { CrawlStrategy } from '../strategies/crawl'

afterEach(() => vi.unstubAllGlobals())

const PAGES: Record<string, string> = {
  'https://brand.com': '<html><head><meta property="og:title" content="Brand"></head><body><nav><a href="/about">關於</a><a href="/products">商品</a></nav></body></html>',
  'https://brand.com/about': '<html><head><meta name="description" content="A Taiwan studio since 2015."></head><body></body></html>',
  'https://brand.com/products': '<html><head><meta name="keywords" content="ceramics,home"></head><body></body></html>',
}

function router(url: string) {
  const body = PAGES[url.replace(/\/$/, '')]
  return body
    ? new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })
    : new Response('x', { status: 404 })
}

const STOCKIST_PAGES: Record<string, string> = {
  'https://brand.com': `<html><head>
    <meta property="og:title" content="Brand">
    <script type="application/ld+json">{"@type":"Product","name":"Widget","image":"https://cdn.brand.com/widget.jpg"}</script>
  </head><body>
    <nav>
      <a href="/about">關於</a>
      <a href="/where-to-buy">通路</a>
    </nav>
  </body></html>`,
  'https://brand.com/about': '<html><head><meta name="description" content="A Taiwan studio since 2015."></head><body></body></html>',
  'https://brand.com/where-to-buy': '<html><head></head><body><main><style>.section-template__main-padding { padding-top: 36px; }</style><script>window.theme = {}</script>寶雅 屈臣氏 Costco 全聯 康是美</main></body></html>',
}

function stockistRouter(url: string) {
  const body = STOCKIST_PAGES[url.replace(/\/$/, '')]
  return body
    ? new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })
    : new Response('x', { status: 404 })
}

describe('CrawlStrategy', () => {
  it('discovers about/products sub-pages and merges their text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((u: string) => Promise.resolve(router(String(u)))))
    const r = await new CrawlStrategy().scrape('https://brand.com', {})
    expect(r.brandName).toBe('Brand')
    expect(r.description ?? r.story).toContain('Taiwan studio')
  })

  it('discovers stockist pages and extracts text + JSON-LD images', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((u: string) => Promise.resolve(stockistRouter(String(u)))))
    const r = await new CrawlStrategy().scrape('https://brand.com', {})
    expect(r.stockistPageText).toContain('寶雅')
    expect(r.stockistPageText).toContain('Costco')
    expect(r.stockistPageText).not.toContain('padding-top')
    expect(r.stockistPageText).not.toContain('window.theme')
    expect(r.jsonLdImageUrls).toContain('https://cdn.brand.com/widget.jpg')
  })

  // DEV-1943: the landing URL was never classified, so a planned store-locator
  // surface lost its own venue list.
  it('keeps a stockist landing page own text as stockistPageText', async () => {
    const pages: Record<string, string> = {
      'https://brand.com/where-to-buy': `<html><head><meta property="og:title" content="Brand"></head><body>
        <nav><a href="/about">關於</a></nav><main>寶雅 屈臣氏 Costco</main></body></html>`,
      'https://brand.com/about': '<html><head><meta name="description" content="A Taiwan studio since 2015."></head><body></body></html>',
    }
    vi.stubGlobal('fetch', vi.fn().mockImplementation((u: string) => {
      const body = pages[String(u).replace(/\/$/, '')]
      return Promise.resolve(body
        ? new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })
        : new Response('x', { status: 404 }))
    }))

    const r = await new CrawlStrategy().scrape('https://brand.com/where-to-buy', {})

    expect(r.stockistPageText).toContain('寶雅')
    expect(r.stockistPageText).toContain('Costco')
  })

  function stubPages(pages: Record<string, string>) {
    const fetchMock = vi.fn().mockImplementation((u: string) => {
      const body = pages[String(u).replace(/\/$/, '')]
      return Promise.resolve(body
        ? new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })
        : new Response('x', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  // DEV-1943: the landing check is path-segment anchored, so `/store` is not a
  // locator and does not block a real stockist sub-page.
  it('fills stockist text from a sub-page when the landing path is only /store', async () => {
    stubPages({
      'https://brand.com/store': `<html><head><meta property="og:title" content="Brand"></head><body>
        <nav><a href="/pages/stockists">Stockists</a></nav><main>Our online store front</main></body></html>`,
      'https://brand.com/pages/stockists': '<html><body><main>誠品書店 信義店</main></body></html>',
    })

    const r = await new CrawlStrategy().scrape('https://brand.com/store', {})

    expect(r.stockistPageText).toContain('誠品書店')
    expect(r.stockistPageText).not.toContain('online store front')
  })

  // DEV-1943: a shared platform's registrable domain does not make a sibling
  // tenant's stockist page the brand's.
  it('ignores stockist text from a sibling tenant on the same platform domain', async () => {
    stubPages({
      'https://brand.myshopify.com': `<html><head><meta property="og:title" content="Brand"></head><body>
        <nav><a href="https://other.myshopify.com/pages/stockists">Stockists</a></nav></body></html>`,
      'https://other.myshopify.com/pages/stockists': '<html><body><main>寶雅 屈臣氏 Costco</main></body></html>',
    })

    const r = await new CrawlStrategy().scrape('https://brand.myshopify.com', {})

    expect(r.brandName).toBe('Brand')
    expect(r.stockistPageText).toBeNull()
  })

  it('ignores a stockist sub-page that redirects off the landing host', async () => {
    const fetchMock = vi.fn().mockImplementation((u: string) => {
      const url = String(u).replace(/\/$/, '')
      if (url === 'https://brand.com') {
        return Promise.resolve(new Response(
          '<html><head><meta property="og:title" content="Brand"></head><body><nav><a href="/where-to-buy">通路</a></nav></body></html>',
          { status: 200, headers: { 'content-type': 'text/html' } },
        ))
      }
      if (url === 'https://brand.com/where-to-buy') {
        const redirected = new Response('<html><body><main>寶雅 屈臣氏 Costco</main></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
        Object.defineProperty(redirected, 'url', { value: 'https://retailer.example/store-locator' })
        return Promise.resolve(redirected)
      }
      return Promise.resolve(new Response('x', { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const r = await new CrawlStrategy().scrape('https://brand.com', {})

    expect(r.stockistPageText).toBeNull()
  })

  it('spends no crawl slot on a stockist sub-page when the landing is a store locator', async () => {
    const fetchMock = stubPages({
      'https://brand.com/where-to-buy': `<html><head><meta property="og:title" content="Brand"></head><body>
        <nav><a href="/pages/stockists">Stockists</a></nav><main>寶雅 屈臣氏</main></body></html>`,
      'https://brand.com/pages/stockists': '<html><body><main>誠品書店 信義店</main></body></html>',
    })

    const r = await new CrawlStrategy().scrape('https://brand.com/where-to-buy', {})

    expect(r.stockistPageText).toContain('寶雅')
    expect(fetchMock.mock.calls.map(([u]) => String(u))).not.toContain('https://brand.com/pages/stockists')
  })
})
