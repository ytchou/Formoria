import { BUDGET } from "../budgets";
import { test, expect } from "../fixtures/auth";

test.describe("Stories navigation deep", () => {
  test("footer has visible 專題 link pointing to /stories", async ({
    anonPage,
  }) => {
    await anonPage.goto("/");
    const storiesLink = anonPage
      .getByRole("contentinfo")
      .getByRole("link", { name: "專題", exact: true });
    await expect(storiesLink).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await expect(storiesLink).toHaveAttribute("href", "/stories");
  });

  test("clicking 專題 footer link arrives at stories hub", async ({
    anonPage,
  }) => {
    await anonPage.goto("/");
    await anonPage
      .getByRole("contentinfo")
      .getByRole("link", { name: "專題", exact: true })
      .click();
    await expect(anonPage).toHaveURL(/\/stories(?:[?#]|$)/, {
      timeout: BUDGET.SERVER_RENDER,
    });
    await expect(
      anonPage.getByRole("heading", { name: "專題", level: 1 }),
    ).toBeVisible({ timeout: BUDGET.INTERACTIVE });
  });
});
