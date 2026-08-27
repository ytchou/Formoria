import { describe, it, expect, vi } from 'vitest'
import { PlatformAdapterStrategy } from '../strategies/platform-adapter'
import type { RenderProvider } from '../render/types'

vi.mock('../fetch-guards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../fetch-guards')>()
  return { ...actual, fetchHtml: vi.fn() }
})

function mockRender(html: string): RenderProvider {
  return {
    fetchRendered: vi
      .fn()
      .mockResolvedValue({ html, finalUrl: 'x', status: 200 }),
  }
}

describe('PlatformAdapterStrategy', () => {
  it('uses a custom-domain Shopline static page without rendering', async () => {
    const render = mockRender('<html></html>')
    const r = await new PlatformAdapterStrategy().scrape(
      'https://shop.example',
      {
        render,
        prefetchedHtml:
          '<script>Shopline.theme={}</script><a href="/products/cup"><img src="https://img.shoplineapp.com/cup.jpg"></a>',
      },
    )
    expect(r.galleryImageUrls).toEqual(['https://img.shoplineapp.com/cup.jpg'])
    expect(render.fetchRendered).not.toHaveBeenCalled()
  })

  it('parses a Pinkoi store name from rendered html', async () => {
    const render = mockRender(
      '<html><head><meta property="og:title" content="小器 Pinkoi 店"></head><body></body></html>',
    )
    const r = await new PlatformAdapterStrategy().scrape(
      'https://pinkoi.com/store/xiaoqi',
      { render, prefetchedHtml: '' },
    )
    expect(r.brandName).toContain('小器')
  })
  it('returns an empty result (graceful) when the render provider throws', async () => {
    const render: RenderProvider = {
      fetchRendered: vi.fn().mockRejectedValue(new Error('blocked')),
    }
    const r = await new PlatformAdapterStrategy().scrape(
      'https://shopee.tw/shop/123',
      { render, prefetchedHtml: '' },
    )
    expect(r.brandName).toBeNull()
  })
  it('sets socialInstagram for an IG url even when sparse', async () => {
    const render = mockRender(
      '<html><head><meta property="og:title" content="@brand"></head><body></body></html>',
    )
    const r = await new PlatformAdapterStrategy().scrape(
      'https://instagram.com/brand',
      { render, prefetchedHtml: '' },
    )
    expect(r.socialInstagram).toContain('instagram.com/brand')
  })

  it('does not bypass the MyShip storefront path guard via fingerprinting', async () => {
    const r = await new PlatformAdapterStrategy().scrape(
      'https://myship.7-11.com.tw/help',
      {
        prefetchedHtml:
          '<meta property="og:title" content="7-ELEVEN Help"><img src="/i/cgdm/GM123">',
      },
    )
    expect(r.brandName).toBeNull()
    expect(r.galleryImageUrls).toEqual([])
  })

  it('supplements 91App listing result with detail-page images', async () => {
    const { fetchHtml } = await import('../fetch-guards')
    const mockedFetchHtml = vi.mocked(fetchHtml)

    // og:image uses a shoplineapp.com host with ?w=300 to verify upgradeEcommerceImageUrl strips it
    const detailHtml = `<html><head>
      <meta property="og:image" content="https://img.shoplineapp.com/large.jpg?w=300" />
      <script type="application/ld+json">{"@type":"Product","image":"https://cms-static.cdn.91app.com/images/original/large-ld.jpg"}</script>
    </head><body></body></html>`

    // Each detail-page fetch returns the same HTML
    mockedFetchHtml.mockResolvedValue(detailHtml)

    const listingHtml = `<html><head>
      <meta property="og:title" content="TestBrand | 91APP" />
    </head><body>
      <div data-salepageid="101">
        <a href="/v2/official/SalePage/Index/101"><img src="https://static.91app.com/images/small.jpg" /></a>
      </div>
      <div data-salepageid="102">
        <a href="/v2/official/SalePage/Index/102"><img src="https://static.91app.com/images/small2.jpg" /></a>
      </div>
    </body></html>`

    const r = await new PlatformAdapterStrategy().scrape(
      'https://www.example.91app.com/v2/official',
      { prefetchedHtml: listingHtml },
    )

    // Original card images are present
    expect(r.galleryImageUrls).toContain(
      'https://static.91app.com/images/small.jpg',
    )
    expect(r.galleryImageUrls).toContain(
      'https://static.91app.com/images/small2.jpg',
    )
    // Detail-page og:image is upgraded (query-string stripped by upgradeEcommerceImageUrl)
    expect(r.galleryImageUrls).toContain(
      'https://img.shoplineapp.com/large.jpg',
    )
    // The raw ?w=300 version should NOT be present
    expect(r.galleryImageUrls).not.toContain(
      'https://img.shoplineapp.com/large.jpg?w=300',
    )
    // JSON-LD images are added
    expect(r.galleryImageUrls).toContain(
      'https://cms-static.cdn.91app.com/images/original/large-ld.jpg',
    )
    // No duplicates
    expect(r.galleryImageUrls.length).toBe(
      new Set(r.galleryImageUrls).size,
    )
    // fetchHtml was called for detail pages
    expect(mockedFetchHtml).toHaveBeenCalled()

    // imageSources for detail-page images have the detail page URL, not the listing URL
    const detailSources = (r.imageSources ?? []).filter(
      (s) => s.pageUrl !== 'https://www.example.91app.com/v2/official',
    )
    expect(detailSources.length).toBeGreaterThan(0)
    for (const s of detailSources) {
      expect(s.pageUrl).toMatch(
        /example\.91app\.com\/v2\/official\/SalePage\/Index\//,
      )
    }

    mockedFetchHtml.mockReset()
  })

  it('does not hydrate detail pages for non-91App platforms', async () => {
    const { fetchHtml } = await import('../fetch-guards')
    const mockedFetchHtml = vi.mocked(fetchHtml)
    mockedFetchHtml.mockReset()

    const r = await new PlatformAdapterStrategy().scrape(
      'https://shop.example',
      {
        prefetchedHtml:
          '<script>Shopline.theme={}</script><a href="/products/cup"><img src="https://img.shoplineapp.com/cup.jpg"></a>',
      },
    )

    expect(r.galleryImageUrls).toEqual(['https://img.shoplineapp.com/cup.jpg'])
    // fetchHtml should NOT be called — prefetchedHtml provided and static parse has images
    expect(mockedFetchHtml).not.toHaveBeenCalled()

    mockedFetchHtml.mockReset()
  })
})
