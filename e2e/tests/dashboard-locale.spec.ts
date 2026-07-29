import { test, expect } from '@playwright/test';
import { ownerFeaturesDisabled, OWNER_FEATURES_OFF_REASON } from '../helpers/owner-features';

// Suite-level gate (DEV-1261). While the flag is off the dashboard answers
// notFound() for a signed-in non-admin, so "never 404" is the wrong contract to
// assert. Probes the running app, never app_settings.
test.beforeAll(async ({ browser }) => {
  if (await ownerFeaturesDisabled(browser)) {
    test.skip(true, OWNER_FEATURES_OFF_REASON);
  }
});

test.describe('protected dashboard locale routing', () => {
  test('/en/dashboard resolves (gated)', async ({ page }) => {
    test.setTimeout(120_000);

    const res = await page.goto('/en/dashboard', { timeout: 60_000 });
    // Either renders (with a session) or redirects to sign-in — never 404
    expect(res?.status()).toBeLessThan(404);
    expect(page.url()).not.toContain('/_next');
  });
});
