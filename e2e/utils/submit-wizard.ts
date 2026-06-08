import { type Page, expect } from '@playwright/test';

/**
 * Navigate to /submit and wait until the wizard is fully interactive.
 *
 * DEV-762 / CI cold-compile: Next.js dev mode compiles routes on-demand.
 * Under 2-worker parallel CI the /submit route may not be compiled when the
 * first spec reaches it, so the first navigation pays a cold-compile cost
 * that can easily exceed 10s.  The URL input (from the UrlStep component) is
 * the most reliable ready-signal: it only mounts after hydration, so waiting
 * on it with a generous budget absorbs the cold-compile latency without
 * weakening any behavioural assertion.
 */
export async function gotoSubmitWizard(
  page: Page,
  opts?: { timeout?: number }
): Promise<void> {
  // 30s default absorbs cold-compile under 2-worker CI (DEV-762).
  const timeout = opts?.timeout ?? 30_000;

  await page.goto('/submit');

  // URL input is the dependable hydration signal — mount requires full JS
  // evaluation.  Assert this first with the full cold-compile budget.
  await expect(page.locator('input[type="url"]').first()).toBeVisible({ timeout });

  // Heading should be essentially immediate once the URL input is mounted;
  // 15s guards residual hydration jitter without adding real wait time.
  await expect(
    page.getByRole('heading', { name: '提交你喜愛的品牌', exact: true })
  ).toBeVisible({ timeout: 15_000 });
}
