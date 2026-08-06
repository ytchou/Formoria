import { expect, test } from "@playwright/test";

const CATEGORY_PATH = "/categories/home";
const SUBCATEGORY_PATH = "/categories/home/furniture";

test.describe("Subcategory navigation deep", () => {
  test("selecting and clearing a subcategory crosses between its landing routes", async ({
    page,
  }) => {
    await page.goto(CATEGORY_PATH);

    const furnitureLink = page
      .getByRole("navigation", { name: "探索此分類的子分類" })
      .getByRole("link", { name: "居家生活・家具" });
    await expect(furnitureLink).toHaveAttribute("href", SUBCATEGORY_PATH);
    await furnitureLink.click();
    await expect(page).toHaveURL(new RegExp(`${SUBCATEGORY_PATH}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "台灣家具品牌",
    );

    const clearFurnitureLink = page
      .getByRole("navigation", { name: "麵包屑導覽" })
      .getByRole("link", { name: "居家生活" });
    await expect(clearFurnitureLink).toHaveAttribute("href", CATEGORY_PATH);
    await clearFurnitureLink.click();
    await expect(page).toHaveURL(new RegExp(`${CATEGORY_PATH}$`));
  });

  test("direct L2 navigation preselects both taxonomy filters", async ({
    page,
  }) => {
    const response = await page.goto(SUBCATEGORY_PATH);
    expect(response?.status()).toBe(200);

    await expect(
      page.locator('aside input[type="checkbox"]:checked'),
    ).toHaveCount(1);
    await expect(
      page.locator("aside").getByRole("link", { name: /^家具 \d+$/ }),
    ).toHaveAttribute("href", CATEGORY_PATH);
    await expect(
      page.getByRole("link", { name: "移除子分類：家具" }),
    ).toBeVisible();
  });
});
