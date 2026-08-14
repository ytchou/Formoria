import { load } from "cheerio";

import { BUDGET } from "../budgets";
import { test, expect } from "../fixtures/auth";
import {
  NO_PUBLISHED_TRAILS,
  publishedTrails,
} from "../utils/published-trails";

const trails = publishedTrails("zh-TW");
const trail =
  trails.find((candidate) => candidate.sections.length >= 3) ?? trails.at(0);
const TRAIL_URL = trail ? `/discover/${trail.slug}` : "/discover";
const SELECTED_REASON_LABEL = "為這個主題選入";
const OFFICIAL_DESTINATION = /前往(?:產品|品牌)官方網站/;

test.describe("Discovery trail deep", () => {
  test.beforeEach(() => {
    test.skip(trail === undefined, NO_PUBLISHED_TRAILS);
  });

  test("trail entrance renders in server HTML", async ({ request }) => {
    const response = await request.get(TRAIL_URL);
    test.skip(response.status() === 503, "PREVIEW_MODE active");

    expect(response.status()).toBe(200);
    const $ = load(await response.text());
    const serverText = $("main").text();

    expect(serverText).toContain(trail!.title);
    for (const section of trail!.sections) {
      expect(serverText).toContain(section.title);
    }
    expect(serverText).toContain(SELECTED_REASON_LABEL);
  });

  test("visitor moves situation → section → product → brand page", async ({
    anonPage,
  }) => {
    test.setTimeout(BUDGET.TEST.JOURNEY);
    const response = await anonPage.goto(TRAIL_URL);
    test.skip(response?.status() === 503, "PREVIEW_MODE active");

    await expect(
      anonPage.getByRole("heading", { name: trail!.title, level: 1 }),
    ).toBeVisible({ timeout: BUDGET.SERVER_RENDER });

    const section = trail?.sections.at(0);
    test.skip(!section, "published trail has no sections");
    await anonPage
      .getByRole("navigation", { name: "主題選物段落" })
      .getByRole("link", { name: section?.title ?? "", exact: true })
      .click();

    const sectionHeading = anonPage.getByRole("heading", {
      name: section.title,
      level: 2,
      exact: true,
    });
    const productTile = anonPage
      .getByRole("listitem")
      .filter({
        has: anonPage.getByText(SELECTED_REASON_LABEL, { exact: true }),
      })
      .first();
    await expect(sectionHeading).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await expect(productTile).toBeVisible({ timeout: BUDGET.SERVER_RENDER });

    const productHeading = productTile.getByRole("heading", { level: 3 });
    const productName = (await productHeading.textContent())?.trim();
    expect(productName).toBeTruthy();
    const productLink = productTile.getByRole("link", {
      name: productName!,
      exact: true,
    });
    const destination = await productLink.getAttribute("href");
    expect(destination).toMatch(
      /^\/brands\/[a-z0-9][a-z0-9-]*#product-[a-z0-9][a-z0-9-]*$/,
    );

    await productLink.click();
    await expect(anonPage).toHaveURL(
      new RegExp(`${escapeRegExp(destination!)}$`),
      {
        timeout: BUDGET.NAVIGATION,
      },
    );
    await expect(
      anonPage.getByRole("heading", { name: productName!, level: 3 }),
    ).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
  });

  test("outbound chip points at the brand's official destination", async ({
    anonPage,
  }) => {
    const response = await anonPage.goto(TRAIL_URL);
    test.skip(response?.status() === 503, "PREVIEW_MODE active");

    const outbound = anonPage
      .getByRole("link", { name: OFFICIAL_DESTINATION })
      .first();
    await expect(outbound).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
    const href = await outbound.getAttribute("href");
    expect(href).toBeTruthy();
    expect(new URL(href!).protocol).toBe("https:");
    expect(new URL(href!).origin).not.toBe(new URL(anonPage.url()).origin);
  });

  test("anchor nav moves focus to the target section", async ({ anonPage }) => {
    const response = await anonPage.goto(TRAIL_URL);
    test.skip(response?.status() === 503, "PREVIEW_MODE active");

    const section = trail?.sections.at(1);
    test.skip(!section, "published trail has fewer than two sections");
    const targetHeading = anonPage.getByRole("heading", {
      name: section?.title ?? "",
      level: 2,
      exact: true,
    });
    await anonPage
      .getByRole("navigation", { name: "主題選物段落" })
      .getByRole("link", { name: section?.title ?? "", exact: true })
      .click();

    await expect(targetHeading).toBeFocused({ timeout: BUDGET.INTERACTIVE });
  });

  test("hub lists the published trail", async ({ anonPage }) => {
    const response = await anonPage.goto("/discover");
    test.skip(response?.status() === 503, "PREVIEW_MODE active");

    const trailHeading = anonPage.getByRole("heading", {
      name: trail!.title,
      level: 2,
      exact: true,
    });
    const trailLink = anonPage.getByRole("link").filter({ has: trailHeading });
    await expect(trailLink).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
    await expect(trailLink).toHaveAttribute("href", TRAIL_URL);
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
