import { describe, it, expect, vi } from 'vitest'
import type { RenderResult } from '../types'

// Stub the audit layer so `createPlaywrightProvider` does not need a real
// `auditedCall` — it just passes through the callback.
vi.mock('@/lib/audit', () => ({
  auditedCall: (_span: unknown, fn: (ctx: { summary: Record<string, unknown> }) => Promise<unknown>) =>
    fn({ summary: {} }),
}))

function makeFakeBrowser() {
  let closed = false
  return {
    get closed() { return closed },
    isConnected: () => !closed,
    async newPage() {
      return {
        async goto(_url: string) {
          return { status: () => 200 }
        },
        async content() {
          return '<html>fake</html>'
        },
        url() {
          return 'https://rendered.example.com'
        },
        async close() {},
      }
    },
    async close() {
      closed = true
    },
  }
}

describe('createRenderProvider', () => {
  it('createRenderProvider_returns_capped_playwright_provider', async () => {
    const browser = makeFakeBrowser()
    const { createRenderProvider } = await import('../provider')
    const { RenderBudgetExceeded, bindBrandKey } = await import('../render-budget')

    const provider = createRenderProvider({
      launch: async () => browser as never,
    })

    const bound = bindBrandKey(provider, 'my-brand')

    // 3 renders succeed (perBrand default is 3)
    const results: RenderResult[] = []
    for (let i = 0; i < 3; i++) {
      results.push(await bound.fetchRendered(`https://example.com/${i}`))
    }
    expect(results).toHaveLength(3)

    // 4th render for the same brand key is refused
    await expect(bound.fetchRendered('https://example.com/4')).rejects.toThrow(
      RenderBudgetExceeded,
    )
  })

  it('close_closes_the_browser', async () => {
    const browser = makeFakeBrowser()
    const { createRenderProvider } = await import('../provider')

    const provider = createRenderProvider({
      launch: async () => browser as never,
    })

    // Trigger a render so the browser is launched
    await provider.fetchRendered('https://example.com')

    expect(browser.closed).toBe(false)
    await provider.close()
    expect(browser.closed).toBe(true)
  })
})
