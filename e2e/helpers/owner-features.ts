import type { Browser } from '@playwright/test'

/**
 * Owner-features gate probe (DEV-1261).
 *
 * `app_settings.owner_features_enabled` gates every owner surface: claiming a
 * brand, the owner dashboard, and the `/submit/owner` fork. It ships default
 * OFF and the server helper fails closed when the row is missing, so at launch
 * only the consumer directory is reachable.
 *
 * This probe is deliberately READ-ONLY and UI-level: it asks the running app
 * what a visitor gets at `/submit/owner` rather than reading or writing
 * `app_settings`. Nothing in the e2e suite may flip the flag — the accepted
 * cost is that owner-flow coverage stays paused until it is turned on for real.
 *
 * Usage — suite-level gate, declared BEFORE any seeding `beforeAll` so the
 * seed never runs for a suite that is about to be skipped:
 *
 *   test.beforeAll(async ({ browser }) => {
 *     if (await ownerFeaturesDisabled(browser)) test.skip(true, OWNER_FEATURES_OFF_REASON)
 *   })
 */
export const OWNER_FEATURES_OFF_REASON =
  'app_settings.owner_features_enabled is false — /submit/owner 404s and every ' +
  'owner surface (claiming, owner dashboard, owner submit fork) is unreachable. ' +
  'Set owner_features_enabled to true to bring this suite back.'

export const OWNER_FEATURES_ON_REASON =
  'app_settings.owner_features_enabled is true — this suite documents the ' +
  'flag-OFF surface only, so its expectations no longer apply.'

/**
 * True when the owner-features flag is off. `/submit/owner` answers 404 while
 * the flag is off and 3xx/200 while it is on, for signed-in and anonymous
 * visitors alike, so an anonymous context is enough.
 *
 * `waitUntil: 'commit'` resolves on response headers — the status is all we
 * need and rendering the 404 body would only add cold-compile time.
 */
export async function ownerFeaturesDisabled(browser: Browser): Promise<boolean> {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    const response = await page.goto('/submit/owner', {
      waitUntil: 'commit',
      timeout: 30_000,
    })
    return response?.status() === 404
  } finally {
    await context.close()
  }
}
