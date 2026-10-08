import { test, expect } from "@playwright/test";
import { BUDGET } from "../budgets";

// Existing staging catalog brands: public brands cannot use the excluded E2E prefix.
const BRAND = "HOKII";

test("a header brand query opens its related brand and removes submit attribution from the URL", async ({
  page,
}) => {
  await page.goto("/stories?q=HOKII");
  const form = page.getByRole("search", { name: "全站商品搜尋" });
  const input = form.getByRole("searchbox", { name: "全站商品搜尋" });
  await expect(input).toHaveValue(BRAND);
  await form.getByRole("button", { name: "清除搜尋" }).click();
  await expect(input).toHaveValue("");
  await input.fill(BRAND);
  await input.press("Enter");
  await expect(
    page.getByRole("heading", { name: `符合「${BRAND}」的商品` }),
  ).toBeVisible({ timeout: BUDGET.NAVIGATION });
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/discover" &&
      url.searchParams.get("q") === BRAND &&
      !url.searchParams.has("src") &&
      !url.searchParams.has("infer"),
  );
  const row = page.getByRole("region", { name: "相關品牌" });
  await row.getByRole("link", { name: BRAND, exact: true }).click();
  await expect(page).toHaveURL(/\/brands\/hokii$/);
  await expect(
    page.getByRole("heading", { level: 1, name: BRAND }),
  ).toBeVisible();
});

test("related brands remain available when the product filters return zero results", async ({
  page,
}) => {
  await page.goto(
    "/discover?q=HOKII&category=home&sub=lighting&material=leather",
  );
  await expect(
    page.getByText(
      "找不到「HOKII」相關的商品，換個關鍵字，或清除篩選條件。",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "相關品牌" })
      .getByRole("link", { name: BRAND, exact: true }),
  ).toBeVisible();
  await page.goto("/discover?q=HOKII&page=2");
  await expect(
    page.getByRole("heading", { name: `符合「${BRAND}」的商品` }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "相關品牌" })).toHaveCount(0);
});

test("deferred categories do not enter the related-brand row", async ({
  page,
}) => {
  await page.goto("/discover?q=柚一村");
  await expect(
    page.getByRole("heading", { name: "符合「柚一村」的商品" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "相關品牌" })
      .getByRole("link", { name: "柚一村 Madoupim" }),
  ).toHaveCount(0);
});

test("directory and discovery own their search on desktop and in the mobile sheet", async ({
  page,
}) => {
  for (const route of ["/brands", "/discover"]) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(route);
    await expect(
      page.getByRole("search", { name: "全站商品搜尋" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("main").getByRole("searchbox", {
        name: route === "/brands" ? "搜尋品牌" : "搜尋商品",
      }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "開啟選單" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("search")).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
});

test("the directory typeahead opens a brand by keyboard", async ({ page }) => {
  await page.goto("/brands");
  const search = page
    .getByRole("main")
    .getByRole("search", { name: "搜尋品牌" })
    .getByRole("searchbox", { name: "搜尋品牌" });
  await search.fill(BRAND);
  await expect(page.getByRole("option", { name: /HOKII/ })).toBeVisible();
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/brands\/hokii$/);
  await expect(
    page.getByRole("heading", { level: 1, name: BRAND }),
  ).toBeVisible();
});
