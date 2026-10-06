import { test, expect, type Locator, type Page } from "@playwright/test";
import { BUDGET } from "../budgets";

const QUERY = "帆布包";
const MAX_TAB_STOPS = 25;
async function heroSearchbox(page: Page): Promise<Locator> {
  const field = page
    .getByRole("search", { name: "搜尋台灣商品" })
    .getByRole("searchbox", { name: "搜尋台灣商品" });
  await expect(field).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
  return field;
}
async function expectProductResults(page: Page) {
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/discover" && url.searchParams.get("q") === QUERY,
    { timeout: BUDGET.NAVIGATION },
  );
  await expect(
    page.getByRole("heading", { name: `符合「${QUERY}」的商品` }),
  ).toBeVisible();
  await expect(
    page.locator("main").getByRole("heading", { level: 3 }).first(),
  ).toBeVisible();
}

async function tabUntilFocused(page: Page, field: Locator) {
  for (let stop = 0; stop < MAX_TAB_STOPS; stop += 1) {
    await page.keyboard.press("Tab");
    if (await field.evaluate((el) => el === document.activeElement)) break;
  }
}

test.describe("Homepage hero product search", () => {
  test("visitors choosing a style reach the style collection in either locale", async ({
    page,
  }) => {
    for (const { path, label, destination } of [
      { path: "/", label: "從風格開始", destination: "/style" },
      { path: "/en", label: "Start from a style", destination: "/en/style" },
    ]) {
      await page.goto(path);
      await page.getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL((url) => url.pathname === destination, {
        timeout: BUDGET.NAVIGATION,
      });
      await expect(
        page.locator('main a[href*="/style/"]').first(),
      ).toBeVisible();
    }
  });

  test("submits to discovery and renders matching products", async ({
    page,
  }) => {
    await page.goto("/");
    const field = await heroSearchbox(page);
    await field.fill(QUERY);
    await field.press("Enter");
    await expectProductResults(page);
    await expect(page.getByRole("searchbox", { name: "搜尋商品" })).toHaveValue(
      QUERY,
    );
  });
  test("completes the same product journey by keyboard alone", async ({
    page,
  }) => {
    await page.goto("/");
    const field = await heroSearchbox(page);
    await tabUntilFocused(page, field);
    await expect(field).toBeFocused();
    await page.keyboard.type(QUERY);
    await page.keyboard.press("Enter");
    await expectProductResults(page);
    await expect(page.getByRole("searchbox", { name: "搜尋商品" })).toHaveValue(
      QUERY,
    );
  });
});
