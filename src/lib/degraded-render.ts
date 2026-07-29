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
 * marks the route dynamic (ƒ) for the whole deployment: `revalidate` produces no
 * static entry and every request renders on demand with no ISR cache. That is bad
 * but recoverable, and it is no longer *silent* — `captureReadFailure` logs and
 * reports every read failure to Sentry, so a demotion is visible without having
 * to fail the build.
 *
 * Failing the build is therefore opt-in. Deploy builds that genuinely expect a
 * reachable database can set `STRICT_PRERENDER_DATA=1` to turn a read failure
 * into a hard build error. It is off by default because CI builds this app with
 * no database on purpose — the Build job is a compile check and points Supabase
 * at 127.0.0.1, so a mandatory throw fails a build that is working as intended.
 */
const STRICT_PRERENDER_DATA = process.env.STRICT_PRERENDER_DATA === '1'

export async function markRenderDegraded(scope: string): Promise<void> {
  if (isPrerendering()) {
    if (STRICT_PRERENDER_DATA) {
      throw new Error(
        `[${scope}] page data read failed during prerender, and STRICT_PRERENDER_DATA is set. `
        + 'Failing the build rather than demoting the route to fully dynamic. '
        + 'See the captured exception above for the cause.',
      )
    }
    console.warn(
      `[${scope}] page data read failed during prerender — this route will be DYNAMIC for the `
      + 'whole deployment, with no ISR cache, until the next build. Set STRICT_PRERENDER_DATA=1 '
      + 'on builds that should fail instead.',
    )
  }
  await connection()
}
