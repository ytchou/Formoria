import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const TEST_FONT = readFileSync(
  join(process.cwd(), "src/assets/fonts/NotoSansTC-subset.ttf"),
).toString("base64");

async function applyDeterministicEmailFont(page: Page) {
  await page.addStyleTag({
    content: `
      @font-face {
        font-family: "Formoria Visual Test";
        src: url(data:font/ttf;base64,${TEST_FONT}) format("truetype");
        font-style: normal;
        font-weight: 100 900;
      }
      *, *::before, *::after {
        font-family: "Formoria Visual Test", sans-serif !important;
      }
    `,
  });
  await page.evaluate(() => document.fonts.ready);
}

test.describe("durable visual surfaces", () => {
  test("zh-TW newsletter confirmation email", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 1_000 });
    const html = execFileSync(
      join(process.cwd(), "node_modules/.bin/tsx"),
      [join(process.cwd(), "e2e/utils/render-newsletter-confirm-visual.ts")],
      { encoding: "utf8" },
    );

    await page.setContent(html, { waitUntil: "load" });
    await applyDeterministicEmailFont(page);

    await expect(page.locator("body")).toHaveScreenshot(
      "newsletter-confirm-zh-TW.png",
      { animations: "disabled", threshold: 0.05 },
    );
  });

  test("root Open Graph image", async ({ page, request }) => {
    const response = await request.get("/opengraph-image");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/png");
    const image = await response.body();

    await page.setViewportSize({ width: 1_200, height: 630 });
    await page.setContent(
      `<style>html,body{margin:0}img{display:block}</style><img alt="" src="data:image/png;base64,${image.toString("base64")}">`,
      { waitUntil: "load" },
    );
    await page.locator("img").evaluate((element: HTMLImageElement) =>
      element.decode(),
    );

    await expect(page.locator("img")).toHaveScreenshot("root-og.png", {
      animations: "disabled",
    });
  });

  test("about audiences section", async ({ page }) => {
    await page.setViewportSize({ width: 1_440, height: 1_000 });
    await page.goto("/zh-TW/about");
    const section = page
      .locator("main > section")
      .filter({
        has: page.getByRole("heading", {
          level: 2,
          name: "兩種找法，同一條接得起來的路",
        }),
      });
    await expect(section).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    await expect(section).toHaveScreenshot("about-audiences-zh-TW.png", {
      animations: "disabled",
    });
  });
});
