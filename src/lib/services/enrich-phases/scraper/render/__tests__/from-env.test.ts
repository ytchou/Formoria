import { describe, it, expect, vi, beforeEach } from 'vitest'

// Stub the providers so the factory can import without real dependencies.
vi.mock('../browserless-provider', () => ({
  createBrowserlessProvider: vi.fn(() => ({
    fetchRendered: vi.fn(),
  })),
}))

vi.mock('../local-playwright-provider', () => ({
  createLocalPlaywrightProvider: vi.fn(() => ({
    fetchRendered: vi.fn(),
  })),
}))

// `render-budget` is deliberately NOT stubbed: what this file has to prove is
// that the factory threads its options INTO the budget wrapper, and a
// pass-through stub makes that unobservable — the monthly gauge shipped
// unwired under exactly that stub.

describe('createRenderProviderFromEnv', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns browserless provider when RENDER_API_KEY is set', async () => {
    vi.stubEnv('RENDER_API_KEY', 'test-key')
    vi.stubEnv('RENDER_LOCAL', '')

    const { createRenderProviderFromEnv } = await import('../from-env')
    const provider = createRenderProviderFromEnv()

    expect(provider).toBeDefined()
    expect(provider!.fetchRendered).toBeDefined()

    const { createBrowserlessProvider } = await import('../browserless-provider')
    expect(createBrowserlessProvider).toHaveBeenCalledWith({ apiKey: 'test-key' })
  })

  it('returns local playwright provider when RENDER_LOCAL=1', async () => {
    vi.stubEnv('RENDER_API_KEY', '')
    vi.stubEnv('RENDER_LOCAL', '1')

    const { createRenderProviderFromEnv } = await import('../from-env')
    const provider = createRenderProviderFromEnv()

    expect(provider).toBeDefined()

    const { createLocalPlaywrightProvider } = await import('../local-playwright-provider')
    expect(createLocalPlaywrightProvider).toHaveBeenCalled()
  })

  it('returns undefined when neither env var is set', async () => {
    vi.stubEnv('RENDER_API_KEY', '')
    vi.stubEnv('RENDER_LOCAL', '')

    const { createRenderProviderFromEnv } = await import('../from-env')
    const provider = createRenderProviderFromEnv()

    expect(provider).toBeUndefined()
  })

  it('budgeted provider works with bindBrandKey', async () => {
    vi.stubEnv('RENDER_API_KEY', 'test-key')
    vi.stubEnv('RENDER_LOCAL', '')

    const { createRenderProviderFromEnv } = await import('../from-env')
    const { bindBrandKey } = await import('../render-budget')
    const provider = createRenderProviderFromEnv()

    const bound = bindBrandKey(provider!, 'brand-x')
    expect(typeof bound.fetchRendered).toBe('function')
  })

  it('threads the injected monthly loader into the render budget', async () => {
    vi.stubEnv('RENDER_API_KEY', 'test-key')
    vi.stubEnv('RENDER_LOCAL', '')

    const { createRenderProviderFromEnv } = await import('../from-env')
    const { RenderBudgetExceeded } = await import('../render-budget')

    let loaded = 0
    const provider = createRenderProviderFromEnv({
      loadMonthlyCount: async () => {
        loaded += 1
        return 900
      },
    })

    // At the 900 threshold the very FIRST render is refused, which is only
    // observable when the loader is actually reached.
    await expect(provider!.fetchRendered('https://example.com')).rejects.toThrow(
      RenderBudgetExceeded,
    )
    await expect(
      provider!.fetchRendered('https://example.com'),
    ).rejects.toMatchObject({ scope: 'monthly' })
    expect(loaded).toBe(1)
  })

  it('leaves the local provider unbudgeted', async () => {
    vi.stubEnv('RENDER_API_KEY', '')
    vi.stubEnv('RENDER_LOCAL', '1')

    const { createRenderProviderFromEnv } = await import('../from-env')
    const provider = createRenderProviderFromEnv({
      loadMonthlyCount: async () => 900,
    })

    // Local provider has no budget wrapper; bindBrandKey is a no-op passthrough.
    expect(provider).toBeDefined()
    expect(typeof provider!.fetchRendered).toBe('function')
  })
})
