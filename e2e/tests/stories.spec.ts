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
      anonPage.getByRole("heading", { name: "專題", level: 1 }),
    ).toBeVisible({ timeout: 10_000 });

    if (stories.length === 0) {
      await expect(anonPage.getByText("敬請期待")).toBeVisible({
        timeout: 10_000,
      });
      await expect(anonPage.locator('main a[href*="/stories/"]')).toHaveCount(
        0,
      );
    } else {
      await expect(
        anonPage.locator('main a[href*="/stories/"]').first(),
      ).toBeVisible({ timeout: 10_000 });
    }
  });

  test("stories hub renders at least one story row once content exists", async ({
    anonPage,
  }) => {
    test.skip(stories.length === 0, NO_PUBLISHED_STORIES);
    await anonPage.goto("/stories");
    await expect(
      anonPage.locator('main a[href*="/stories/"]').first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("?tag= URL renders the hub and is not redirected away", async ({
    anonPage,
  }) => {
    await anonPage.goto("/stories?tag=beauty");
    await expect(anonPage).toHaveURL(/[?&]tag=beauty/, { timeout: 10_000 });
    await expect(
      anonPage.getByRole("heading", { name: "專題", level: 1 }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("hub no longer renders a tag filter nav", async ({ anonPage }) => {
    await anonPage.goto("/stories");
    await expect(
      anonPage.getByRole("heading", { name: "專題", level: 1 }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      anonPage.getByRole("navigation", { name: "專題標籤" }),
    ).toHaveCount(0);
  });

  test("story row click navigates to the story detail page", async ({
    anonPage,
  }) => {
    test.skip(stories.length === 0, NO_PUBLISHED_STORIES);
    await anonPage.goto("/stories");
    const firstRow = anonPage.locator('main a[href*="/stories/"]').first();
    await expect(firstRow).toBeVisible({ timeout: 10_000 });
    await firstRow.click();
    await expect(anonPage).toHaveURL(/\/stories\/[a-z0-9][a-z0-9-]+/, {
      timeout: 15_000,
    });
    await expect(anonPage).not.toHaveTitle(/^404/);
    await expect(anonPage.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });
  });
});
