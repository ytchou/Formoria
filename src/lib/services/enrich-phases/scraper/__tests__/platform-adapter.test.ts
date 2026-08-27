import { describe, it, expect, vi } from 'vitest'
import { PlatformAdapterStrategy } from '../strategies/platform-adapter'
import type { RenderProvider } from '../render/types'

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
})
