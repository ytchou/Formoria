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
 * into a per-process cap (DEV-1644 F8).
 */
export type RenderProviderWithBudget = BudgetWrappedProvider

/**
 * Build a Playwright-backed RenderProvider with budget enforcement.
 *
 * The provider manages a single Chromium instance (launched lazily on first
 * render) and enforces a per-brand cap via the render budget wrapper.
 *
 * The cap is a runaway backstop, not a cost control: a local render costs about
 * $0.00007 of worker compute. It is sized to one brand's worst-case demand in a
 * job — acquisition agent 3 + catalog discovery (a listing per source, 25
 * hydrations, 15 follow-throughs) + products agent 4, about 51 — with headroom.
 * Raise it if any of those ceilings grows (DEV-1908).
 *
 * No per-job cap: per-brand caps and each phase's deadline already bound a job,
 * and a fixed job total starved every brand after the first few in a batch.
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
      perBrand: 60,
      perJob: Number.POSITIVE_INFINITY,
    },
  )
}
