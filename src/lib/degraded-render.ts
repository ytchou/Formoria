import * as Sentry from '@sentry/nextjs'
import { connection } from 'next/server'
import { PHASE_PRODUCTION_BUILD } from 'next/constants'

/**
 * Builds a `.catch()` handler for a page data read that may fail without taking
 * the whole page down. The read degrades to `null`, but the error is still
 * reported — a silent `.catch(() => null)` serves an empty 200 with no
 * error-rate signal anywhere.
 */
export function captureReadFailure(scope: string): (error: unknown) => null {
  return (error: unknown) => {
    console.error(`[${scope}] page data read failed:`, error)
    Sentry.captureException(error, { tags: { scope, area: 'page-data-read' } })
    return null
  }
}

/** True only while `next build` prerenders; `next start` sets a different phase
 *  and `NEXT_PHASE` is not inlined at build time, so this is a runtime read. */
function isPrerendering(): boolean {
  return process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD
}

/**
 * Marks the current render as degraded so it is never frozen into the ISR cache.
 *
 * At request time that means `connection()`, which opts this single render out
 * of the static cache so the next request retries against the DB.
 *
 * At prerender time `connection()` is `throwToInterruptStaticGeneration`, which
 * would mark the route dynamic (ƒ) for the entire deployment: `revalidate` would
 * produce no static entry and every request would render on demand with no ISR
 * cache, with nothing surfacing it at runtime. A build-time read failure
 * therefore fails the build loudly instead — a failed deploy is recoverable,
 * a silently uncached route is not.
 */
export async function markRenderDegraded(scope: string): Promise<void> {
  if (isPrerendering()) {
    throw new Error(
      `[${scope}] page data read failed during prerender. Failing the build rather than `
      + 'demoting the route to fully dynamic. See the captured exception above for the cause.',
    )
  }
  await connection()
}
