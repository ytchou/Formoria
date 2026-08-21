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

  /*
   * The footer's entry point to this hub, folded in from the deleted
   * `events-navigation.spec.ts`.
   *
   * Not owned by `src/components/navigation/footer-links.test.ts`: that unit
   * test calls `getFooterFullDocumentHref()` and compares strings without ever
   * rendering a footer. Not owned by the case above either — it `goto()`s the
   * hub directly and never touches `contentinfo`. Scoped to `contentinfo`
   * because 展會 is also a header nav label; the deleted spec used an unscoped
   * locator, which is strict-mode ambiguous.
   */
  test("footer has a visible 展會 link pointing to /events", async ({
    anonPage,
  }) => {
    await anonPage.goto("/");
    const eventsLink = anonPage
      .getByRole("contentinfo")
      .getByRole("link", { name: "展會", exact: true });
    await expect(eventsLink).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await expect(eventsLink).toHaveAttribute("href", "/events");
  });
});
