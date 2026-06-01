import { describe, it, expect, vi } from 'vitest'
import { PlatformAdapterStrategy } from '../strategies/platform-adapter'
import type { RenderProvider } from '../render/types'

function mockRender(html: string): RenderProvider {
  return { fetchRendered: vi.fn().mockResolvedValue({ html, finalUrl: 'x', status: 200 }) }
}

describe('PlatformAdapterStrategy', () => {
  it('parses a Pinkoi store name from rendered html', async () => {
    const render = mockRender('<html><head><meta property="og:title" content="小器 Pinkoi 店"></head><body></body></html>')
    const r = await new PlatformAdapterStrategy().scrape('https://pinkoi.com/store/xiaoqi', { render })
    expect(r.brandName).toContain('小器')
  })
  it('returns an empty result (graceful) when the render provider throws', async () => {
    const render: RenderProvider = { fetchRendered: vi.fn().mockRejectedValue(new Error('blocked')) }
    const r = await new PlatformAdapterStrategy().scrape('https://shopee.tw/shop/123', { render })
    expect(r.brandName).toBeNull()
  })
  it('sets socialLinks.instagram for an IG url even when sparse', async () => {
    const render = mockRender('<html><head><meta property="og:title" content="@brand"></head><body></body></html>')
    const r = await new PlatformAdapterStrategy().scrape('https://instagram.com/brand', { render })
    expect(r.socialLinks.instagram).toContain('instagram.com/brand')
  })
})
