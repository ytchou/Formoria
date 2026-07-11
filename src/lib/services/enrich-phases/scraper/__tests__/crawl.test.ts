import { describe, it, expect, vi, afterEach } from 'vitest'
import { CrawlStrategy } from '../strategies/crawl'
import { getRenderProvider } from '../render/index'

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
  'https://brand.com/where-to-buy': '<html><head></head><body><main>寶雅 屈臣氏 Costco 全聯 康是美</main></body></html>',
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
    const r = await new CrawlStrategy().scrape('https://brand.com', { render: getRenderProvider() })
    expect(r.brandName).toBe('Brand')
    expect(r.description ?? r.story).toContain('Taiwan studio')
  })

  it('discovers stockist pages and extracts text + JSON-LD images', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((u: string) => Promise.resolve(stockistRouter(String(u)))))
    const r = await new CrawlStrategy().scrape('https://brand.com', { render: getRenderProvider() })
    expect(r.stockistPageText).toContain('寶雅')
    expect(r.stockistPageText).toContain('Costco')
    expect(r.jsonLdImageUrls).toContain('https://cdn.brand.com/widget.jpg')
  })
})
