import { BUDGET } from "../budgets";
import { test, expect } from "@playwright/test";

test("@cross-browser header search reaches product results from stories", async ({
  page,
}) => {
  await page.goto("/stories");
  const search = page
    .getByRole("banner")
    .getByRole("search", { name: "搜尋商品", exact: true })
    .getByRole("searchbox", { name: "搜尋商品", exact: true });
  await expect(search).toBeVisible({ timeout: BUDGET.INTERACTIVE });
  await search.fill("帆布包");
  await search.press("Enter");
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/discover" && url.searchParams.get("q") === "帆布包",
    { timeout: BUDGET.NAVIGATION },
  );
  await expect(
    page.getByRole("heading", { name: "符合「帆布包」的商品" }),
  ).toBeVisible();
  await expect(
    page.locator("main").getByRole("heading", { level: 3 }).first(),
  ).toBeVisible();
});
