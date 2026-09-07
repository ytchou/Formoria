import type { Browser } from '@playwright/test'
import { createPlaywrightProvider } from './playwright-provider'
import { withRenderBudget, type BudgetWrappedProvider } from './render-budget'

/**
 * What this factory returns: a Playwright-backed render provider wrapped with
 * concurrency and budget enforcement.
 *
 * Callers that know the brand should wrap this with `bindBrandKey(provider,
 * brand.id)` before passing it through the scraping pipeline. Without binding,
 * every brand shares the default `'unknown'` key and turns the per-brand cap
 * of 3 into a per-process cap of 3 (DEV-1644 F8).
 */
export type RenderProviderWithBudget = BudgetWrappedProvider

/**
 * Build a Playwright-backed RenderProvider with budget enforcement.
 *
 * The provider manages a single Chromium instance (launched lazily on first
 * render) and enforces per-brand (3) and per-job (150) caps via the render
 * budget wrapper.
 *
 * Call `close()` when the job finishes to shut down the browser.
 */
export function createRenderProvider(
  options?: { brandKey?: () => string; launch?: () => Promise<Browser> },
): RenderProviderWithBudget {
  return withRenderBudget(
    createPlaywrightProvider({ launch: options?.launch }),
    {
      brandKey: options?.brandKey ?? (() => 'unknown'),
      perBrand: 3,
      perJob: 150,
    },
  )
}
