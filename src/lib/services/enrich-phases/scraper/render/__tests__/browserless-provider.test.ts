import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { RenderResult } from '../types'

// Stub audit so the provider can import without the full audit stack.
vi.mock('@/lib/audit', () => ({
  auditedCall: (_spec: unknown, fn: (ctx: { summary: Record<string, unknown> }) => unknown) =>
    fn({ summary: {} }),
}))

// Stub isPrivateUrl — tested in its own suite.
vi.mock('@/lib/url', () => ({
  isPrivateUrl: (url: string) => {
    try {
      const host = new URL(url).hostname
      return host === 'localhost' || host === '127.0.0.1' || host.startsWith('10.') || host.startsWith('192.168.')
    } catch {
      return true
    }
  },
}))

describe('createBrowserlessProvider', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('posts a content request and maps the html response', async () => {
    const html = '<html><body>Hello</body></html>'
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(html),
    })
    globalThis.fetch = mockFetch

    const { createBrowserlessProvider } = await import('../browserless-provider')
    const provider = createBrowserlessProvider({ apiKey: 'KEY' })
    const result: RenderResult = await provider.fetchRendered('https://example.com')

    expect(result).toEqual({ html, finalUrl: 'https://example.com', status: 200 })

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://production-sfo.browserless.io/content?token=KEY')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({
      url: 'https://example.com',
      gotoOptions: { waitUntil: 'networkidle2' },
      rejectResourceTypes: ['image', 'media', 'font'],
      bestAttempt: true,
    })
  })

  it('throws with status on non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: () => Promise.resolve('rate limited'),
    })

    const { createBrowserlessProvider } = await import('../browserless-provider')
    const provider = createBrowserlessProvider({ apiKey: 'KEY' })

    await expect(provider.fetchRendered('https://example.com')).rejects.toThrow('429')
  })

  it('refuses a private URL before calling the vendor', async () => {
    const mockFetch = vi.fn()
    globalThis.fetch = mockFetch

    const { createBrowserlessProvider } = await import('../browserless-provider')
    const provider = createBrowserlessProvider({ apiKey: 'KEY' })

    await expect(provider.fetchRendered('http://10.0.0.1/')).rejects.toThrow()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
