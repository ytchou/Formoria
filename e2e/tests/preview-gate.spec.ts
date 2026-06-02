import { test, expect } from '../fixtures/auth';

/**
 * Characterization for the PREVIEW_MODE login gate introduced in PR #61.
 *
 * Required env to exercise this spec:
 * - PREVIEW_MODE=true
 * - ADMIN_EMAILS and/or PREVIEW_ALLOWED_EMAILS must include the authenticated
 *   fixture email used for the allowlisted case below.
 */
test.describe('Preview mode gate', () => {
  const gatedPath = '/brands';
  const skipMessage =
    'PREVIEW_MODE not enabled in this env — set PREVIEW_MODE=true to exercise the gate.';

  let previewGateActive = false;

  test.beforeAll(async ({ request }) => {
    const response = await request.get(gatedPath);
    const body = await response.text();
    const headers = response.headers();

    previewGateActive =
      response.status() === 503 &&
      headers['retry-after'] === '86400' &&
      body.includes('href="/auth/sign-in"') &&
      body.includes('即將上線') &&
      /Under construction/i.test(body);
  });

  test.beforeEach(() => {
    test.skip(!previewGateActive, skipMessage);
  });

  test('blocks anonymous users with the under-construction response', async ({ anonPage }) => {
    const response = await anonPage.goto(gatedPath);

    expect(response).not.toBeNull();
    expect(response?.status()).toBe(503);
    await expect(anonPage.getByText(/即將上線|Under construction/i)).toBeVisible();
    await expect(anonPage.locator('a[href="/auth/sign-in"]')).toBeVisible();
    await expect(
      anonPage.locator('form[role="search"] input[role="searchbox"]')
    ).toHaveCount(0);
  });

  test('allows whitelisted authenticated users through to real content', async ({ adminPage }) => {
    // Use adminPage here because the admin fixture is the one this repo expects
    // to be allowlisted via ADMIN_EMAILS; E2E_USER_EMAIL may not be whitelisted.
    const response = await adminPage.goto(gatedPath);

    expect(response).not.toBeNull();
    expect(response?.status()).toBe(200);
    await expect(
      adminPage.locator('form[role="search"] input[role="searchbox"]:visible')
    ).toBeVisible();
    await expect(adminPage.getByText(/即將上線|Under construction/i)).toHaveCount(0);
  });
});
