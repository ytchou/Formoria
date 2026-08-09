import { test, expect } from "../fixtures/auth";

test.describe("Events navigation deep", () => {
  test("nav has visible 展會 link pointing to /events", async ({
    anonPage,
  }) => {
    await anonPage.goto("/");
    const eventsLink = anonPage.getByRole("link", { name: "展會", exact: true });
    await expect(eventsLink).toBeVisible({ timeout: 10_000 });
    await expect(eventsLink).toHaveAttribute("href", "/events");
  });

  test("clicking 展會 nav link arrives at events hub", async ({ anonPage }) => {
    await anonPage.goto("/");
    await anonPage.getByRole("link", { name: "展會", exact: true }).click();
    await expect(anonPage).toHaveURL(/\/events(?:[?#]|$)/, { timeout: 15_000 });
    await expect(
      anonPage.getByRole("heading", { name: "展會", level: 1 }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
