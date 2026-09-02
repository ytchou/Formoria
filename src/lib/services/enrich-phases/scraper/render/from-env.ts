import type { RenderProvider } from './types'
import { createBrowserlessProvider } from './browserless-provider'
import { createLocalPlaywrightProvider } from './local-playwright-provider'
import { withRenderBudget } from './render-budget'

/**
 * Build a RenderProvider from environment variables.
 *
 * - RENDER_API_KEY → Browserless (wrapped with render budget)
 * - RENDER_LOCAL=1 → local Playwright (no budget, for dev use)
 * - Neither        → undefined (rendering unavailable)
 */
export function createRenderProviderFromEnv(): RenderProvider | undefined {
  const apiKey = process.env.RENDER_API_KEY?.trim()
  const local = process.env.RENDER_LOCAL?.trim()

  if (apiKey) {
    return withRenderBudget(createBrowserlessProvider({ apiKey }), {
      brandKey: () => 'unknown',
      perBrand: 3,
      perJob: 150,
      monthly: {
        threshold: 900,
        // The monthly count loader is injected by the caller when wired into
        // the curation pipeline. For standalone use the gauge starts at zero.
        loadCount: async () => 0,
      },
    })
  }

  if (local) {
    return createLocalPlaywrightProvider()
  }

  return undefined
}
