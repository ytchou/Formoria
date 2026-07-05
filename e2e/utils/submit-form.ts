import { type Page, expect } from '@playwright/test';

/**
 * Navigate to /submit/form and wait until the flat single-screen form is
 * fully interactive (hydrated and rendered).
 *
 * The form at /submit/form is now a single-screen flat form — no wizard
 * phases, no URL discovery step, no step indicator.  All required fields
 * (website, brand name, owner checkbox) are visible immediately after
 * the page hydrates.
 *
 * DEV-877 / DEV-762 / CI cold-compile: Next.js dev mode compiles routes on
 * demand.  Under 2-worker parallel CI the /submit/form route may not be
 * compiled when the first spec reaches it, so the first navigation pays a
 * cold-compile cost that can easily exceed 10 s.  The page-level h1 is the
 * most reliable ready-signal — it only mounts after hydration.
 *
 * Auth resilience: under parallel load the middleware auth check can
 * transiently fail, redirecting to /auth/sign-in. If detected, the helper
 * retries the navigation once.
 */
export async function gotoSubmitForm(
  page: Page,
  opts?: { timeout?: number },
): Promise<void> {
  const timeout = opts?.timeout ?? 90_000;

  await expect(async () => {
    await page.goto('/submit/form', { timeout: 60_000 });
    // Preserve auth-redirect detection — middleware can transiently redirect
    if (page.url().includes('/auth/sign-in')) {
      throw new Error('Auth redirect detected — middleware not ready, retrying');
    }
    await expect(
      page.getByRole('heading', { name: '提交品牌', exact: true }),
    ).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout, intervals: [2_000, 4_000, 8_000] });
}
