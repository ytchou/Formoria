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

vi.mock('../render-budget', () => ({
  withRenderBudget: (_inner: unknown) => _inner,
  RenderBudgetExceeded: class extends Error {},
}))

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
})
