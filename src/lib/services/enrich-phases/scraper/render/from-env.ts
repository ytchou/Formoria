import type { RenderProvider } from './types'
import { createBrowserlessProvider } from './browserless-provider'
import { createLocalPlaywrightProvider } from './local-playwright-provider'
import { withRenderBudget } from './render-budget'

export interface RenderProviderFromEnvOptions {
  /** Returns the current brand slug for per-brand budget tracking. Defaults to `() => 'unknown'`. */
  brandKey?: () => string
  /**
   * Loads the running monthly render count. Defaults to `async () => 0`, which
   * disables the monthly cap — supply `loadBrowserlessMonthlyCount` from
   * `./monthly-gauge` in anything that runs against a real Browserless key.
   */
  loadMonthlyCount?: () => Promise<number>
}

/**
 * What this factory returns: a render provider that MAY carry budget tracking.
 *
 * Callers that know the brand should wrap this with `bindBrandKey(provider,
 * brand.id)` before passing it through the scraping pipeline. Without binding,
 * every brand shares the default `'unknown'` key and turns the per-brand cap
 * of 3 into a per-process cap of 3 (DEV-1644 F8).
 */
export type RenderProviderWithBudget = RenderProvider

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
): RenderProviderWithBudget | undefined {
  const apiKey = process.env.RENDER_API_KEY?.trim()
  const local = process.env.RENDER_LOCAL?.trim()

  if (apiKey) {
    return withRenderBudget(createBrowserlessProvider({ apiKey }), {
      brandKey: options?.brandKey ?? (() => 'unknown'),
      perBrand: 3,
      perJob: 150,
      monthly: {
        threshold: 900,
        // The monthly count loader is injected by the caller (the worker and
        // the rerun script both pass `loadBrowserlessMonthlyCount`). For
        // standalone use the gauge starts at zero, which leaves only the
        // per-brand and per-job caps in force.
        loadCount: options?.loadMonthlyCount ?? (async () => 0),
      },
    })
  }

  if (local) {
    return createLocalPlaywrightProvider()
  }

  return undefined
}
