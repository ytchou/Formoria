import { test, expect } from "@playwright/test";

import { BUDGET } from "../budgets";

test.describe("Homepage curated product deep", () => {
  test("homepage curated rail leads to the selected product on its brand page", async ({
    page,
  }) => {
    await page.goto("/");

    const selectedProducts = page.getByRole("region", {
      name: "Formoria 選物",
    });
    const railIsAbsent = (await selectedProducts.count()) === 0;
    test.skip(
      railIsAbsent,
      "The homepage curated rail is hidden below its public supply gate.",
    );

    await expect(selectedProducts).toBeVisible({
      timeout: BUDGET.SERVER_RENDER,
    });
    const firstProductLink = selectedProducts.getByRole("link").first();
    const destination = await firstProductLink.getAttribute("href");
    expect(destination).toMatch(/^\/brands\/[^#]+#product-[^#]+$/);

    await firstProductLink.click();

    await expect(page).toHaveURL(new RegExp(`${destination}$`), {
      timeout: BUDGET.NAVIGATION,
    });
    const productAnchor = new URL(destination!, "http://localhost").hash;
    await expect(page.locator(productAnchor)).toBeVisible({
      timeout: BUDGET.SERVER_RENDER,
    });
  });
});
