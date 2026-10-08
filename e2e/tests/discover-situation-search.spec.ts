import { BUDGET } from "../budgets";
import { test, expect } from "@playwright/test";

test.describe("Discover situation search", () => {
  test("renders search results with noindex and relevance sort", async ({
    page,
  }) => {
    await page.goto("/discover?q=茶壺", {
      timeout: BUDGET.NAVIGATION,
    });

    const robots = page.locator('meta[name="robots"]');
    await expect(robots).toHaveAttribute("content", /noindex/, {
      timeout: BUDGET.RENDERED,
    });

    await expect(
      page.getByLabel("搜尋商品"),
    ).toBeVisible({ timeout: BUDGET.RENDERED });

    // Search mode titles the page 搜尋結果; the query moves to the intro line.
    const resultsHeading = page.getByRole("heading", {
      level: 1,
      name: "搜尋結果",
      exact: true,
    });
    await expect(resultsHeading).toBeVisible({ timeout: BUDGET.RENDERED });
    await expect(
      page.locator("main").getByText("「茶壺」", { exact: true }),
    ).toHaveAttribute("title", "茶壺");

    const mainContent = page.locator("main");
    const productGrid = mainContent.locator("ul.grid").filter({ has: page.getByRole("heading", { level: 3 }) });
    const emptyState = mainContent.getByText("找不到「茶壺」相關的商品");

    await expect(
      productGrid.or(emptyState),
    ).toBeVisible({ timeout: BUDGET.RENDERED });
  });

  test("search form submits and navigates with query", async ({ page }) => {
    await page.goto("/discover", { timeout: BUDGET.NAVIGATION });

    const input = page.getByLabel("搜尋商品");
    await expect(input).toBeVisible({ timeout: BUDGET.RENDERED });
    await input.fill("送禮");
    // exact: the field's clear button (清除搜尋) also contains 搜尋 once it has text.
    await page.getByRole("button", { name: "搜尋", exact: true }).click();

    await page.waitForURL(/[?&]q=/, { timeout: BUDGET.INTERACTIVE });

    await expect(
      page.getByRole("heading", { level: 1, name: "搜尋結果", exact: true }),
    ).toBeVisible({ timeout: BUDGET.RENDERED });
    await expect(
      page.locator("main").getByText("「送禮」", { exact: true }),
    ).toBeVisible();
  });

  test("search mode states the result count once; browse mode keeps its total", async ({
    page,
  }) => {
    await page.goto("/discover", { timeout: BUDGET.NAVIGATION });
    const main = page.locator("main");

    // Browse mode: the catalog total.
    await expect(main.getByText(/共 \d+ 件商品/)).toBeVisible({
      timeout: BUDGET.SERVER_RENDER,
    });

    // A 子分類 label is a real product noun, so it searches to results without
    // pinning a term to the stale staging catalog.
    const firstOption = page
      .getByRole("navigation", { name: "篩選商品", exact: true })
      .getByRole("group", { name: "子分類", exact: true })
      .locator("label")
      .filter({ visible: true })
      .first();
    await expect(firstOption).toBeVisible({ timeout: BUDGET.RENDERED });
    const term = (await firstOption.innerText())
      .split("\n")[0]
      .replace(/\s*\d+\s*$/, "")
      .trim();

    await page.goto(`/discover?q=${encodeURIComponent(term)}`, {
      timeout: BUDGET.NAVIGATION,
    });
    await expect(
      page.getByRole("heading", { level: 1, name: "搜尋結果", exact: true }),
    ).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
    await expect(main.getByText(`「${term}」`, { exact: true })).toBeVisible();
    // One count sentence whether or not the candidate pool was capped.
    await expect(main.getByText(/依相關度排列 · \d+ 件/)).toHaveCount(1);
    await expect(main.getByText(/共 \d+ 件商品/)).toHaveCount(0);
  });

  test("a nonsense query reaches the empty state with forward routes", async ({
    page,
  }) => {
    // DEV-1964: the relevance floor drops every candidate for a Latin string
    // with no lexical hit, so the page must not claim a count.
    await page.goto("/discover?q=asdfqwer", { timeout: BUDGET.NAVIGATION });
    const main = page.locator("main");
    await expect(
      main.getByText(
        "找不到「asdfqwer」相關的商品，換個關鍵字，或清除篩選條件。",
        { exact: true },
      ),
    ).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
    await expect(main.getByText(/依相關度排列/)).toHaveCount(0);
    await expect(
      main.getByRole("heading", { name: "依分類看全部商品", exact: true }),
    ).toBeVisible();
  });
});
