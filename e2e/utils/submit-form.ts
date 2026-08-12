import { BUDGET, POLL } from "../budgets";
import { type Page, expect } from "@playwright/test";

export async function gotoSubmitRecommend(page: Page): Promise<void> {
  await expect(async () => {
    await page.goto("/submit/recommend");
    const heading = page.getByRole("heading", {
      name: "推薦品牌",
      exact: true,
    });
    await expect(heading).toBeVisible({ timeout: BUDGET.RENDERED });
  }).toPass(POLL.SUBMIT);
}

/**
 * Owner quick-submit form. `/submit/owner/quick` 404s while
 * `owner_features_enabled` is off (DEV-1261), and this helper polls for the
 * heading with `toPass`, so callers must check the route's status and skip
 * before calling it — otherwise they spend the full timeout on a page that will
 * never render. See e2e/tests/community-submit.spec.ts.
 */
export async function gotoSubmitOwner(page: Page): Promise<void> {
  await expect(async () => {
    await page.goto("/submit/owner/quick");
    await expect(
      page.getByRole("heading", { name: "快速建立品牌頁", exact: true }),
    ).toBeVisible({ timeout: BUDGET.RENDERED });
  }).toPass(POLL.SUBMIT);
}
