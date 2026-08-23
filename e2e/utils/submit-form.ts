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
