import type { APIRequestContext } from "@playwright/test";
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
// Not a per-product selection reason — DEV-1496 removed those. This is the
// generic badge `SelectedProductTile` renders beside the product description
// (selected-product-tile.tsx:311), so it is still live on every trail tile.
const SELECTED_BADGE_LABEL = "為這個主題選入";
const OFFICIAL_DESTINATION = /前往(?:產品|品牌)官方網站/;

// The trail is published in MDX, but the page 404s when the database holds too
// few curated products for it. Probe once per worker so those runs skip, not
// fail: the answer is environment-level, so every test in the worker reuses it.
// A transport error resolves to null, which skips nothing.
let trailStatusProbe: Promise<number | null> | undefined;

function probeTrailStatus(
  request: APIRequestContext,
): Promise<number | null> {
  trailStatusProbe ??= request
    .get(TRAIL_URL)
    .then((response) => response.status())
    .catch(() => null);
  return trailStatusProbe;
}

test.describe("Discovery trail deep", () => {
  test.beforeEach(async ({ request }) => {
    test.skip(trail === undefined, NO_PUBLISHED_TRAILS);

    const status = await probeTrailStatus(request);
    test.skip(status === 404, "trail has no published curated products");
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
    expect(serverText).toContain(SELECTED_BADGE_LABEL);
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
      // A selected-product tile is identified by the h3 SelectedProductTile
      // renders for the product name — the next line reads that same heading.
      .filter({ has: anonPage.getByRole("heading", { level: 3 }) })
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
