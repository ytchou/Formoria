import { type Page, expect } from '@playwright/test';

/**
 * Navigate to /submit/form and wait until the URL discovery phase is fully interactive.
 *
 * The form at /submit/form is a two-phase single-screen flow:
 *   Phase 1 (url): UrlStep — enter brand URL, social/purchase links, skip to form.
 *   Phase 2 (form): BrandInfoStep — single-screen with name, region, owner, PDPA, submit.
 * There is no step indicator or wizard navigation; calling this helper lands you on Phase 1.
 *
 * DEV-762 / CI cold-compile: Next.js dev mode compiles routes on-demand.
 * Under 2-worker parallel CI the /submit/form route may not be compiled when
 * the first spec reaches it, so the first navigation pays a cold-compile cost
 * that can easily exceed 10s.  The URL input (from the UrlStep component) is
 * the most reliable ready-signal: it only mounts after hydration, so waiting
 * on it with a generous budget absorbs the cold-compile latency without
 * weakening any behavioural assertion.
 *
 * Auth resilience: under parallel load the middleware auth check can
 * transiently fail, redirecting to /auth/sign-in. If detected, the helper
 * retries the navigation once.
 */
export async function gotoSubmitWizard(
  page: Page,
  opts?: { timeout?: number }
): Promise<void> {
  const timeout = opts?.timeout ?? 30_000;
  const backoff = [2_000, 4_000, 8_000];

  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto('/submit/form', { timeout: 60_000 });

    const urlInput = page.locator('input[type="url"]').first();
    const visible = await urlInput.isVisible({ timeout }).catch(() => false);
    if (visible) {
      await expect(
        page.getByRole('heading', { name: '提交品牌', exact: true })
      ).toBeVisible({ timeout: 15_000 });
      return;
    }

    if (attempt < 2 && page.url().includes('/auth/sign-in')) {
      await page.waitForTimeout(backoff[attempt]);
      continue;
    }

    await expect(urlInput).toBeVisible({ timeout: 10_000 });
  }
}
