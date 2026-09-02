import type { RenderProvider } from './types'
import { createBrowserlessProvider } from './browserless-provider'
import { createLocalPlaywrightProvider } from './local-playwright-provider'
import { withRenderBudget } from './render-budget'

export interface RenderProviderFromEnvOptions {
  /** Returns the current brand slug for per-brand budget tracking. Defaults to `() => 'unknown'`. */
  brandKey?: () => string
  /** Loads the running monthly render count. Defaults to `async () => 0` (placeholder). */
  loadMonthlyCount?: () => Promise<number>
}

/**
 * Build a RenderProvider from environment variables.
 *
 * - RENDER_API_KEY → Browserless (wrapped with render budget)
 * - RENDER_LOCAL=1 → local Playwright (no budget, for dev use)
 * - Neither        → undefined (rendering unavailable)
 *
 * Callers that know the brand at scrape time should pass `brandKey` so budget
 * tracking is per-brand rather than lumped under 'unknown'. The curation worker
 * creates one provider at startup, so it uses `setBrandKey` on the returned
 * provider before each brand's scrape instead.
 */
export function createRenderProviderFromEnv(
  options?: RenderProviderFromEnvOptions,
): RenderProvider | undefined {
  const apiKey = process.env.RENDER_API_KEY?.trim()
  const local = process.env.RENDER_LOCAL?.trim()

  if (apiKey) {
    return withRenderBudget(createBrowserlessProvider({ apiKey }), {
      brandKey: options?.brandKey ?? (() => 'unknown'),
      perBrand: 3,
      perJob: 150,
      monthly: {
        threshold: 900,
        // The monthly count loader is injected by the caller when wired into
        // the curation pipeline. For standalone use the gauge starts at zero.
        loadCount: options?.loadMonthlyCount ?? (async () => 0),
      },
    })
  }

  if (local) {
    return createLocalPlaywrightProvider()
  }

  return undefined
}
