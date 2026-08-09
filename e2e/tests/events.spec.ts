import { BUDGET } from "../budgets";
import { test, expect } from "../fixtures/auth";

const COMING_SOON = "首波展會資訊正在整理中，敬請期待。";

test.describe("Events hub deep", () => {
  test("@smoke events hub renders a stable empty or published state", async ({
    anonPage,
  }) => {
    const response = await anonPage.goto("/events");
    expect(response?.status()).toBe(200);
    await expect(
      anonPage.getByRole("heading", { name: "展會", level: 1 }),
    ).toBeVisible({ timeout: BUDGET.INTERACTIVE });

    const cards = anonPage.locator('main a[href*="/events/"]');
    if ((await cards.count()) === 0) {
      await expect(anonPage.getByText(COMING_SOON)).toBeVisible({
        timeout: BUDGET.INTERACTIVE,
      });
    } else {
      await expect(anonPage.getByText(COMING_SOON)).toHaveCount(0);
      await expect(cards.first()).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    }
  });
});
