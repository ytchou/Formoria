import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RenderResult } from '../types'

// Stub audit so the provider can import without the full audit stack.
vi.mock('@/lib/audit', () => ({
  auditedCall: (
    spec: Record<string, unknown>,
    fn: (ctx: { summary: Record<string, unknown> }) => unknown,
    _opts?: { summary?: Record<string, unknown> },
  ) => {
    const ctx = { summary: {} }
    const result = fn(ctx)
    // Attach spec + ctx.summary so tests can inspect the audit span.
    if (result && typeof result === 'object' && 'then' in result) {
      return (result as Promise<unknown>).then((r) => {
        ;(r as Record<string, unknown>).__auditSpec = spec
        ;(r as Record<string, unknown>).__auditSummary = ctx.summary
        return r
      })
    }
    return result
  },
}))

// ---------- Fake Browser / Page ----------

function makeFakePage(overrides?: {
  gotoError?: Error
  html?: string
  finalUrl?: string
  status?: number
}) {
  const html = overrides?.html ?? '<html></html>'
  const finalUrl = overrides?.finalUrl ?? 'https://example.com'
  const status = overrides?.status ?? 200
  const gotoError = overrides?.gotoError
  return {
    goto: vi.fn().mockImplementation(async () => {
      if (gotoError) throw gotoError
      return { status: () => status }
    }),
    content: vi.fn().mockResolvedValue(html),
    url: vi.fn().mockReturnValue(finalUrl),
    close: vi.fn().mockResolvedValue(undefined),
  }
}

function makeFakeBrowser(pages?: ReturnType<typeof makeFakePage>[]) {
  let pageIndex = 0
  const defaultPage = makeFakePage()
  let connected = true
  return {
    newPage: vi.fn().mockImplementation(async () => {
      if (pages && pageIndex < pages.length) return pages[pageIndex++]
      return defaultPage
    }),
    close: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockImplementation(() => connected),
    _setConnected(v: boolean) { connected = v },
  }
}

type FakeBrowser = ReturnType<typeof makeFakeBrowser>

describe('createPlaywrightProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('launches_chromium_once_across_fetches', async () => {
    const browser = makeFakeBrowser()
    const launch = vi.fn().mockResolvedValue(browser)

    const { createPlaywrightProvider } = await import('../playwright-provider')
    const provider = createPlaywrightProvider({ launch })

    await provider.fetchRendered('https://a.com')
    await provider.fetchRendered('https://b.com')
    await provider.fetchRenderedBatch!(['https://c.com'])

    expect(launch).toHaveBeenCalledTimes(1)
    expect(browser.newPage).toHaveBeenCalledTimes(3)
  })

  it('concurrent_first_fetches_launch_once_and_close_closes_it', async () => {
    const browser = makeFakeBrowser()
    // Delay launch to force concurrent callers to share the inflight promise.
    const launch = vi.fn().mockImplementation(
      () => new Promise<FakeBrowser>((resolve) => setTimeout(() => resolve(browser), 10)),
    )

    const { createPlaywrightProvider } = await import('../playwright-provider')
    const provider = createPlaywrightProvider({ launch })

    const [r1, r2] = await Promise.all([
      provider.fetchRendered('https://a.com'),
      provider.fetchRendered('https://b.com'),
    ])

    expect(r1).toBeDefined()
    expect(r2).toBeDefined()
    expect(launch).toHaveBeenCalledTimes(1)

    await provider.close()
    expect(browser.close).toHaveBeenCalledTimes(1)
  })

  it('failed_launch_clears_inflight_promise', async () => {
    const browser = makeFakeBrowser()
    const launch = vi
      .fn()
      .mockRejectedValueOnce(new Error('launch boom'))
      .mockResolvedValue(browser)

    const { createPlaywrightProvider } = await import('../playwright-provider')
    const provider = createPlaywrightProvider({ launch })

    await expect(provider.fetchRendered('https://a.com')).rejects.toThrow('launch boom')

    // Second call should re-launch successfully.
    const result = await provider.fetchRendered('https://b.com')
    expect(result).toBeDefined()
    expect(launch).toHaveBeenCalledTimes(2)
  })

  it('relaunches_after_disconnect', async () => {
    const browser1 = makeFakeBrowser()
    const browser2 = makeFakeBrowser()
    const launch = vi
      .fn()
      .mockResolvedValueOnce(browser1)
      .mockResolvedValueOnce(browser2)

    const { createPlaywrightProvider } = await import('../playwright-provider')
    const provider = createPlaywrightProvider({ launch })

    await provider.fetchRendered('https://a.com')
    expect(launch).toHaveBeenCalledTimes(1)

    // Simulate disconnect.
    browser1._setConnected(false)

    await provider.fetchRendered('https://b.com')
    expect(launch).toHaveBeenCalledTimes(2)
  })

  it('close_closes_browser_and_next_fetch_relaunches', async () => {
    const browser1 = makeFakeBrowser()
    const browser2 = makeFakeBrowser()
    const launch = vi
      .fn()
      .mockResolvedValueOnce(browser1)
      .mockResolvedValueOnce(browser2)

    const { createPlaywrightProvider } = await import('../playwright-provider')
    const provider = createPlaywrightProvider({ launch })

    await provider.fetchRendered('https://a.com')
    await provider.close()
    expect(browser1.close).toHaveBeenCalledTimes(1)

    // Fetch after close relaunches.
    await provider.fetchRendered('https://b.com')
    expect(launch).toHaveBeenCalledTimes(2)

    // Second close on idle provider is a no-op (browser2 is still open but
    // calling close again after already closing is fine).
    await provider.close()
    expect(browser2.close).toHaveBeenCalledTimes(1)

    // Another close when no browser is held is a silent no-op.
    await provider.close()
    expect(browser2.close).toHaveBeenCalledTimes(1)
  })

  it('batch_returns_null_for_failed_pages', async () => {
    const okPage = makeFakePage({ html: '<ok/>', finalUrl: 'https://ok.com', status: 200 })
    const badPage = makeFakePage({ gotoError: new Error('page boom') })
    const browser = makeFakeBrowser([okPage, badPage])
    const launch = vi.fn().mockResolvedValue(browser)

    const { createPlaywrightProvider } = await import('../playwright-provider')
    const provider = createPlaywrightProvider({ launch })

    const results = await provider.fetchRenderedBatch!(['https://ok.com', 'https://bad.com'])

    expect(results).toHaveLength(2)
    expect(results[0]).not.toBeNull()
    expect((results[0] as RenderResult).html).toBe('<ok/>')
    expect(results[1]).toBeNull()
  })

  it('fetch_records_audit_span_with_playwright_provider', async () => {
    const page = makeFakePage({ html: '<h1>hi</h1>', finalUrl: 'https://final.com', status: 200 })
    const browser = makeFakeBrowser([page])
    const launch = vi.fn().mockResolvedValue(browser)

    const { createPlaywrightProvider } = await import('../playwright-provider')
    const provider = createPlaywrightProvider({ launch })

    const result = await provider.fetchRendered('https://example.com')
    const spec = (result as unknown as Record<string, unknown>).__auditSpec as Record<string, unknown>
    const summary = (result as unknown as Record<string, unknown>).__auditSummary as Record<string, unknown>

    expect(spec.provider).toBe('playwright')
    expect(spec.operation).toBe('fetch_rendered')
    expect(summary.finalUrl).toBe('https://final.com')
    expect(summary.status).toBe(200)
  })
})
