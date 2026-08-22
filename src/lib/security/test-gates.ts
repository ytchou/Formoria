/**
 * Granular test-only security switches (DEV-1551, task 17).
 *
 * THE PROBLEM THIS REPLACES. `PLAYWRIGHT_TEST=true` was one flag that disabled
 * TWO unrelated things: the rate limiter (in `src/proxy.ts`) and Turnstile
 * verification (in `src/lib/security/turnstile.ts`). `playwright.config.ts` sets
 * it at config load AND hardcodes it into every `webServer` launch command, and
 * the dev server is shared across Playwright projects — so a project could never
 * turn either gate back on. There was no way to write an adversarial spec that
 * exercises the limiter, because the only switch that reached the server also
 * stubbed Turnstile.
 *
 * The two switches below are independent, so a future Playwright project can
 * enable the limiter while Turnstile stays stubbed, or the reverse.
 *
 * THIS IS THE ONE FILE THAT MAY READ `PLAYWRIGHT_TEST` for security gating.
 * `proxy.ts` and `turnstile.ts` deliberately do not: a grep for the old flag in
 * either file must come back empty, or the split has silently regressed. The
 * fallback lives here so a runner that still exports only the legacy flag
 * (`PLAYWRIGHT_TEST=true pnpm start` typed by hand, an old CI job, the specs
 * that stub it directly) keeps the behaviour it has today.
 *
 * Ceiling: the fallback means the legacy flag is still load-bearing for anyone
 * who has not migrated. Upgrade path: once nothing sets `PLAYWRIGHT_TEST`
 * without also setting these two, delete `legacyPlaywrightFlag()` and let the
 * switches default to false.
 */

/** Disables the hard rate limiter and the soft `/brands/*` limit. */
export const RATE_LIMIT_DISABLED_ENV = 'SECURITY_DISABLE_RATE_LIMIT'

/** Makes `verifyTurnstileToken` succeed without calling Cloudflare. */
export const TURNSTILE_STUBBED_ENV = 'SECURITY_STUB_TURNSTILE'

const TRUTHY = new Set(['1', 'true', 'on', 'yes'])
const FALSY = new Set(['0', 'false', 'off', 'no'])

/**
 * Explicit beats inherited. An unrecognised value is treated as unset rather
 * than as `true`: a typo must never be the thing that disables a security gate
 * on a deployed environment.
 */
function readSwitch(name: string): boolean | null {
  const value = process.env[name]?.trim().toLowerCase()
  if (!value) return null
  if (TRUTHY.has(value)) return true
  if (FALSY.has(value)) return false
  return null
}

function legacyPlaywrightFlag(): boolean {
  return process.env.PLAYWRIGHT_TEST === 'true'
}

export function isRateLimitDisabled(): boolean {
  return readSwitch(RATE_LIMIT_DISABLED_ENV) ?? legacyPlaywrightFlag()
}

export function isTurnstileStubbed(): boolean {
  return readSwitch(TURNSTILE_STUBBED_ENV) ?? legacyPlaywrightFlag()
}

/**
 * NOT a security gate. Crawler-hit telemetry is suppressed during e2e runs so a
 * Playwright browser's User-Agent does not pollute the crawler counters. It
 * lives here only so `src/proxy.ts` has no direct `PLAYWRIGHT_TEST` read left --
 * splitting the two SECURITY switches would be pointless if the flag stayed in
 * the file under another name.
 *
 * Deliberately has no override of its own: nothing wants a matrix dimension for
 * whether telemetry is recorded, and adding one would imply otherwise.
 */
export function isCrawlerTelemetrySuppressed(): boolean {
  return legacyPlaywrightFlag()
}
