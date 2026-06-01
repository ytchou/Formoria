import { test, expect } from '@playwright/test';

test.describe('protected dashboard locale routing', () => {
  test('/en/dashboard resolves (gated)', async ({ page }) => {
    const res = await page.goto('/en/dashboard');
    // Either renders (with a session) or redirects to sign-in — never 404
    expect(res?.status()).toBeLessThan(404);
    expect(page.url()).not.toContain('/_next');
  });
});
