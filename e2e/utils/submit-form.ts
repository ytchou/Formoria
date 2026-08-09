import { BUDGET } from "../budgets";
import { type Page, expect } from "@playwright/test";

export async function gotoSubmitRecommend(
  page: Page,
  opts?: { timeout?: number },
): Promise<void> {
  const timeout = opts?.timeout ?? 90_000;

  await expect(async () => {
    await page.goto("/submit/recommend");

    const heading = page.getByRole("heading", {
      name: "推薦品牌",
      exact: true,
    });
    const visible = await heading.isVisible({ timeout }).catch(() => false);
    if (visible) {
      return;
    }

    await expect(heading).toBeVisible({ timeout: BUDGET.RENDERED });
  }).toPass({ timeout, intervals: [2_000, 4_000, 8_000] });
}

/**
 * Owner quick-submit form. `/submit/owner/quick` 404s while
 * `owner_features_enabled` is off (DEV-1261), and this helper polls for the
 * heading with `toPass`, so callers must check the route's status and skip
 * before calling it — otherwise they spend the full timeout on a page that will
 * never render. See e2e/tests/community-submit.spec.ts.
 */
export async function gotoSubmitOwner(
  page: Page,
  opts?: { timeout?: number },
): Promise<void> {
  const timeout = opts?.timeout ?? 90_000;

  await expect(async () => {
    await page.goto("/submit/owner/quick");
    await expect(
      page.getByRole("heading", { name: "快速建立品牌頁", exact: true }),
    ).toBeVisible({ timeout: BUDGET.RENDERED });
  }).toPass({ timeout, intervals: [2_000, 4_000, 8_000] });
}
