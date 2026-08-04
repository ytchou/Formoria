import { test, expect } from "../fixtures/auth";

test.describe("Stories navigation deep", () => {
  test("footer has visible 專題 link pointing to /stories", async ({
    anonPage,
  }) => {
    await anonPage.goto("/");
    const storiesLink = anonPage.getByRole("link", { name: "專題" });
    await expect(storiesLink).toBeVisible({ timeout: 10_000 });
    await expect(storiesLink).toHaveAttribute("href", "/stories");
  });

  test("clicking 專題 footer link arrives at stories hub", async ({
    anonPage,
  }) => {
    await anonPage.goto("/");
    await anonPage.getByRole("link", { name: "專題" }).click();
    await expect(anonPage).toHaveURL(/\/stories(?:[?#]|$)/, {
      timeout: 15_000,
    });
    await expect(
      anonPage.getByRole("heading", { name: "專題", level: 1 }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
