import { test, expect } from "@playwright/test";
import { load } from "cheerio";

import { BUDGET } from "../budgets";
import { requireWallOrSkip } from "../utils/wall-supply";

test.describe("Homepage curated product deep", () => {
  test("homepage curated rail leads to the selected product on its brand page", async ({
    page,
  }) => {
    await page.goto("/");

    const selectedProducts = page.getByRole("region", {
      name: "Formoria 選物",
    });
    requireWallOrSkip((await selectedProducts.count()) === 0);

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

  test("the wall ends in a continuation strip rather than scrolling forever", async ({
    page,
  }) => {
    const response = await page.goto("/");
    test.skip(response?.status() === 503, "PREVIEW_MODE active");

    const selectedProducts = page.getByRole("region", {
      name: "Formoria 選物",
    });
    requireWallOrSkip((await selectedProducts.count()) === 0);

    await expect(
      selectedProducts.getByRole("heading", {
        name: "繼續探索",
        level: 3,
        exact: true,
      }),
    ).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
    await expect(
      selectedProducts.getByRole("link", {
        name: "探索所有品牌 →",
        exact: true,
      }),
    ).toHaveAttribute("href", "/brands", { timeout: BUDGET.RENDERED });
  });

  test("a discovery trail tile inside the wall leads to its trail", async ({
    page,
  }) => {
    const response = await page.goto("/");
    test.skip(response?.status() === 503, "PREVIEW_MODE active");

    const selectedProducts = page.getByRole("region", {
      name: "Formoria 選物",
    });
    requireWallOrSkip((await selectedProducts.count()) === 0);

    const wallLinks = selectedProducts
      .getByRole("list", { name: "Formoria 選物", exact: true })
      .getByRole("link");
    const wallHrefs = await wallLinks.evaluateAll((links) =>
      links.map((link) => link.getAttribute("href") ?? ""),
    );
    const trailLinkIndex = wallHrefs.findIndex((href) =>
      /^\/discover\/[a-z0-9-]+$/.test(href),
    );
    test.skip(
      trailLinkIndex === -1,
      "The homepage wall has no discovery trail tile at the current supply gate.",
    );

    const trailLink = wallLinks.nth(trailLinkIndex);
    const destination = await trailLink.getAttribute("href");
    expect(destination).toMatch(/^\/discover\/[a-z0-9-]+$/);
    const trailTitle = (await trailLink.ariaSnapshot()).match(
      /^- link "(.+)"$/m,
    )?.[1];
    expect(trailTitle).toBeTruthy();

    await trailLink.click();

    await expect(page).toHaveURL(new RegExp(`${destination}$`), {
      timeout: BUDGET.NAVIGATION,
    });
    await expect(
      page.getByRole("heading", {
        name: trailTitle!,
        level: 1,
        exact: true,
      }),
    ).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
  });

  test("every wall tile exposes its selection rationale in the server HTML", async ({
    request,
  }) => {
    const response = await request.get("/");
    test.skip(response.status() === 503, "PREVIEW_MODE active");
    expect(response.status()).toBe(200);

    const $ = load(await response.text());
    const selectedProducts = $("section")
      .filter((_, section) =>
        $(section)
          .find("h2")
          .toArray()
          .some((heading) => $(heading).text().trim() === "Formoria 選物"),
      )
      .first();
    requireWallOrSkip(selectedProducts.length === 0);

    const productTiles = selectedProducts.find("li").filter((_, item) =>
      $(item)
        .find("a")
        .toArray()
        .some((link) =>
          /^\/brands\/[^#]+#product-[^#]+$/.test($(link).attr("href") ?? ""),
        ),
    );
    expect(productTiles.length).toBeGreaterThan(0);

    productTiles.each((_, item) => {
      const productLink = $(item)
        .find("a")
        .toArray()
        .find((link) =>
          /^\/brands\/[^#]+#product-[^#]+$/.test($(link).attr("href") ?? ""),
        );
      expect($(productLink).attr("href")).toMatch(
        /^\/brands\/[^#]+#product-[^#]+$/,
      );

      const rationaleMarkers = $(item).find("[data-selection-rationale]");
      expect(rationaleMarkers.length).toBe(1);

      const rationaleMarker = rationaleMarkers.first();
      const rawRationale = rationaleMarker.attr("data-selection-rationale");
      expect(rawRationale).toBeDefined();
      const rationale = rawRationale!.trim();
      expect(rationale.length).toBeGreaterThan(0);
      expect(rawRationale).toBe(rationale);
      expect(rationaleMarker.text().trim()).toBe(rationale);
    });
  });
});
