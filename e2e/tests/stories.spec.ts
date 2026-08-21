import { BUDGET } from "../budgets";
import { test, expect } from "../fixtures/auth";
import {
  NO_PUBLISHED_STORIES,
  publishedStories,
} from "../utils/published-stories";

const stories = publishedStories("zh-TW");

test.describe("Stories hub deep", () => {
  test("@smoke stories hub renders a published or empty state", async ({
    anonPage,
  }) => {
    const response = await anonPage.goto("/stories");
    expect(response?.status()).toBe(200);
    await expect(
      anonPage.getByRole("heading", { name: "專題", level: 1, exact: true }),
    ).toBeVisible({ timeout: BUDGET.INTERACTIVE });

    if (stories.length === 0) {
      // The empty-state copy is 首波專題正在整理中，敬請期待。 — a bare substring
      // match on the tail also resolves to any other "敬請期待" the page grows,
      // so it is scoped to main and taken as the first match explicitly.
      await expect(anonPage.locator("main").getByText("敬請期待").first()).toBeVisible({
        timeout: BUDGET.INTERACTIVE,
      });
      await expect(anonPage.locator('main a[href*="/stories/"]')).toHaveCount(
        0,
      );
    } else {
      await expect(
        anonPage.locator('main a[href*="/stories/"]').first(),
      ).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    }
  });

  test("?tag= URL renders the hub and is not redirected away", async ({
    anonPage,
  }) => {
    await anonPage.goto("/stories?tag=beauty");
    await expect(anonPage).toHaveURL(/[?&]tag=beauty/, { timeout: BUDGET.INTERACTIVE });
    await expect(
      anonPage.getByRole("heading", { name: "專題", level: 1 }),
    ).toBeVisible({ timeout: BUDGET.INTERACTIVE });
  });

  test("story row click navigates to the story detail page", async ({
    anonPage,
  }) => {
    test.skip(stories.length === 0, NO_PUBLISHED_STORIES);
    await anonPage.goto("/stories");
    const firstRow = anonPage.locator('main a[href*="/stories/"]').first();
    await expect(firstRow).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await firstRow.click();
    await expect(anonPage).toHaveURL(/\/stories\/[a-z0-9][a-z0-9-]+/, {
      timeout: BUDGET.SERVER_RENDER,
    });
    await expect(anonPage).not.toHaveTitle(/^404/);
    await expect(anonPage.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });
  });
});
