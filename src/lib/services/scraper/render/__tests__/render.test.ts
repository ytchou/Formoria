import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); delete process.env.RENDER_API_KEY })

describe('createHostedRenderProvider', () => {
  it('POSTs to the token endpoint and returns rendered html', async () => {
    const { createHostedRenderProvider } = await import('../hosted-provider')
    const fetchSpy = vi.fn().mockResolvedValue(new Response('<html>rendered</html>', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    const provider = createHostedRenderProvider('test-key', { baseUrl: 'https://chrome.example.com' })
    const res = await provider.fetchRendered('https://pinkoi.com/store/foo')
    expect(res.html).toContain('rendered')
    const calledUrl = String(fetchSpy.mock.calls[0][0])
    expect(calledUrl).toContain('token=test-key')
  })
})

describe('getRenderProvider', () => {
  it('returns the hosted provider when RENDER_API_KEY is set', async () => {
    process.env.RENDER_API_KEY = 'k'
    const { getRenderProvider } = await import('../index')
    expect(getRenderProvider()).toHaveProperty('fetchRendered')
  })
})
