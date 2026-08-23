import { test, expect } from "@playwright/test";
import { load } from "cheerio";

import { BUDGET } from "../budgets";
import { publishedTrails } from "../utils/published-trails";
import { requireWallOrSkip } from "../utils/wall-supply";

test.describe("Homepage curated product deep", () => {
  test("homepage curated rail leads to the selected product on its brand page", async ({
    page,
  }) => {
    await page.goto("/");

    const selectedProducts = page.getByRole("region", {
      name: "Formoria 選物",
    });
    await requireWallOrSkip((await selectedProducts.count()) === 0);

    await expect(selectedProducts).toBeVisible({
      timeout: BUDGET.SERVER_RENDER,
    });
    const firstProductLink = selectedProducts.getByRole("link").first();
    const destination = await firstProductLink.getAttribute("href");
    // NO `#product-` anchor from the wall (changed 2026-08-17). A homepage tile
    // is first contact with the brand, so it lands on the top of the brand page
    // rather than mid-page at one product. The anchored form is still asserted
    // from a trail, in discovery-trail.spec.ts.
    expect(destination).toMatch(/^\/brands\/[^#]+$/);

    await firstProductLink.click();

    await expect(page).toHaveURL(new RegExp(`${destination}$`), {
      timeout: BUDGET.NAVIGATION,
    });
    // The brand page opens at its own heading, not scrolled into the selection.
    await expect(
      page.getByRole("heading", { level: 1 }),
    ).toBeInViewport({ timeout: BUDGET.SERVER_RENDER });
  });

  test("the wall does not duplicate the hero's browse entry points", async ({
    page,
  }) => {
    const response = await page.goto("/");
    test.skip(response?.status() === 503, "PREVIEW_MODE active");

    const selectedProducts = page.getByRole("region", {
      name: "Formoria 選物",
    });
    await requireWallOrSkip((await selectedProducts.count()) === 0);

    await expect(selectedProducts).toBeVisible({
      timeout: BUDGET.SERVER_RENDER,
    });
    // The whole continuation strip was removed on 2026-08-17: its trail links
    // are their own zone now, and the category nav and the directory button
    // that also lived here are both still linked from the hero. Asserted as
    // ABSENT so they cannot quietly come back and duplicate the hero.
    //
    // Anchored on structure, not copy: the CTA is matched by its /brands href
    // and the category nav by its landmark role. A name-based matcher would go
    // vacuous the next time the button copy is rewritten — silently, since an
    // absence assertion passes when its selector stops matching anything.
    await expect(
      selectedProducts.locator('a[href$="/brands"], a[href*="/brands?"]'),
    ).toHaveCount(0);
    await expect(selectedProducts.getByRole("navigation")).toHaveCount(0);
  });

  test("a discovery trail card leads to its trail", async ({
    page,
  }) => {
    const response = await page.goto("/");
    test.skip(response?.status() === 503, "PREVIEW_MODE active");
    test.skip(
      publishedTrails().length === 0,
      "no published trails in content/trails",
    );

    const trailsZone = page.locator('[data-landing-zone="trails"]');
    await expect(trailsZone).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
    const trailLink = trailsZone.getByRole("listitem").first().getByRole("link");
    const destination = await trailLink.getAttribute("href");
    expect(destination).toMatch(/^\/discover\/[a-z0-9-]+$/);
    // The trailing `:?` is load-bearing. Playwright ends a node's line with a
    // colon when it has children, and this link has them — the snapshot reads
    // `- link "<title>":` followed by `- /url:` and `- text:`. Without it the
    // match returned undefined and the test failed on an empty title while the
    // tile was rendering perfectly (DEV-1514).
    const trailTitle = (await trailLink.ariaSnapshot()).match(
      /^- link "(.+?)":?$/m,
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

  test("every rendered trail card carries a photograph", async ({ page }) => {
    const response = await page.goto("/");
    test.skip(response?.status() === 503, "PREVIEW_MODE active");
    test.skip(
      publishedTrails().length === 0,
      "no published trails in content/trails",
    );

    const cards = page
      .locator('[data-landing-zone="trails"]')
      .getByRole("listitem");
    await expect(cards.first()).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
    const count = await cards.count();
    for (let index = 0; index < count; index += 1) {
      await expect(cards.nth(index).getByRole("img")).toHaveCount(1);
    }
  });

  test("every wall tile links to its product and carries no rationale", async ({
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
    await requireWallOrSkip(selectedProducts.length === 0);

    const productTiles = selectedProducts.find("li").filter((_, item) =>
      $(item)
        .find("a")
        .toArray()
        .some((link) =>
          /^\/brands\/[^#]+$/.test($(link).attr("href") ?? ""),
        ),
    );
    expect(productTiles.length).toBeGreaterThan(0);

    productTiles.each((_, item) => {
      const productLink = $(item)
        .find("a")
        .toArray()
        .find((link) =>
          /^\/brands\/[^#]+$/.test($(link).attr("href") ?? ""),
        );
      expect($(productLink).attr("href")).toMatch(/^\/brands\/[^#]+$/);

      // The wall stopped rendering selection rationales on 2026-08-17. Asserted
      // as absent rather than deleted: this spec reads the SERVER HTML, so it
      // is the only guard that catches a rationale returning to the homepage
      // wall — where it would again be a crawler-visible claim.
      expect($(item).find("[data-selection-rationale]").length).toBe(0);
    });
  });
});
