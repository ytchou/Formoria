import type { Page } from '@playwright/test'

import { BUDGET } from '../budgets'

/**
 * Blocks until ViewerProvider has settled.
 *
 * Admin- and owner-gated controls render `null` until viewer context resolves,
 * so asserting one directly cannot distinguish three different failures: the
 * viewer fetch is still in flight, it resolved and the viewer genuinely lacks
 * the role, or it threw and resolved fail-closed. All three surfaced as
 * `element(s) not found` after a long wait, and each one got "repaired" by
 * raising the timeout (DEV-1414).
 *
 * Gate on this first, then assert the control itself at `BUDGET.RENDERED` — once
 * the viewer is ready the control either exists or is broken, and a long wait
 * can only delay a true failure.
 *
 * Throws rather than times out on the two states a timeout would misreport:
 * a failed viewer fetch (`error`), and a page that never mounted the provider
 * at all (`global-error.tsx` renders its own <html> outside it).
 */
export async function waitForViewerReady(
  page: Page,
): Promise<void> {
  const state = await page
    .waitForFunction(
      () => {
        const value = document.documentElement.dataset.viewerState
        return value === 'ready' || value === 'error' ? value : null
      },
      undefined,
      { timeout: BUDGET.GATED_UI },
    )
    .then((handle) => handle.jsonValue())

  if (state === 'error') {
    throw new Error(
      'Viewer context failed to load (data-viewer-state="error"). Admin and ' +
        'owner controls are hidden because the fetch threw, not because the ' +
        'viewer lacks the role — this is an app failure, not a slow test.',
    )
  }
}
