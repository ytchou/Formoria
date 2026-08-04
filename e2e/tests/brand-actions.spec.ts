import { test, expect } from "../fixtures/auth";
import { seedBrand, type SeededBrand } from "../helpers/seed";

/**
 * Public brand actions and admin placement.
 *
 * These journeys exercise the controls that sit beside a brand name on the
 * detail page: anonymous support and the admin menu's position in the heading
 * row.
 */

/** /admin/brands renders in 5-6.5s under CI load — well past the 5s expect default. */
const ADMIN_NAV_TIMEOUT = 30_000;

test.describe("Brand detail actions", () => {
  let seeded: SeededBrand;

  test.beforeAll(async ({}, workerInfo) => {
    seeded = await seedBrand({
      name: "actions",
      status: "approved",
      workerIndex: workerInfo.workerIndex,
      withLinks: true,
    });
  });

  test.afterAll(async () => {
    await seeded.cleanup();
  });

  test("anonymous visitor can add and remove public support", async ({
    anonPage,
  }) => {
    const response = await anonPage.goto(`/brands/${seeded.slug}`, {
      waitUntil: "domcontentloaded",
    });
    if (response?.status() === 503) {
      test.skip(true, "PREVIEW_MODE active — skipping.");
      return;
    }

    const supportButton = anonPage.getByRole("button", {
      name: /支持這個品牌，目前有 \d+ 個支持/,
    });
    await expect(supportButton).toBeVisible({ timeout: 15_000 });
    await expect(supportButton).toHaveAttribute("aria-pressed", "false");
    await expect(supportButton).toHaveAttribute(
      "aria-label",
      "支持這個品牌，目前有 0 個支持",
    );

    await supportButton.click();

    const removeSupportButton = anonPage.getByRole("button", {
      name: /收回對這個品牌的支持，目前有 \d+ 個支持/,
    });
    await expect(removeSupportButton).toBeVisible({ timeout: 15_000 });
    await expect(removeSupportButton).toHaveAttribute("aria-pressed", "true");
    await expect(removeSupportButton).toHaveAttribute(
      "aria-label",
      "收回對這個品牌的支持，目前有 1 個支持",
    );

    await removeSupportButton.click();
    await expect(
      anonPage.getByRole("button", {
        name: "支持這個品牌，目前有 0 個支持",
      }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  test("admin menu is aligned to the right of the brand heading", async ({
    adminPage,
  }) => {
    const response = await adminPage.goto(`/brands/${seeded.slug}`, {
      waitUntil: "domcontentloaded",
    });
    if (response?.status() === 503) {
      test.skip(true, "PREVIEW_MODE active — skipping.");
      return;
    }

    const heading = adminPage.getByRole("heading", { level: 1 });
    const menu = adminPage.getByRole("button", { name: "管理選單" });
    await expect(heading).toBeVisible({ timeout: 15_000 });
    await expect(menu).toBeVisible({ timeout: 15_000 });

    const headingBox = await heading.boundingBox();
    const menuBox = await menu.boundingBox();
    expect(headingBox).not.toBeNull();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.x).toBeGreaterThanOrEqual(
      headingBox!.x + headingBox!.width,
    );
    expect(Math.abs(menuBox!.y - headingBox!.y)).toBeLessThanOrEqual(12);
  });

  test("admin can edit and hide the selected brand from its detail menu", async ({
    adminPage,
  }, workerInfo) => {
    // Matches every other admin spec. This test walks brand detail → admin edit
    // dialog → admin catalog → brand detail → hide; each admin navigation costs
    // 4-6.5s, so the journey alone needs ~30s of server time. Under the 30s CI
    // default it died at whichever step drained the budget — the edit dialog in
    // one run, the post-hide redirect in the next — which read as two unrelated
    // bugs (DEV-1312). The per-assertion ADMIN_NAV_TIMEOUT above is the other
    // half: expect() has its own 5s default that the test budget does not lift.
    test.setTimeout(120_000);

    const managedBrand = await seedBrand({
      name: "admin-menu-actions",
      status: "approved",
      workerIndex: workerInfo.workerIndex,
    });
    const escapedBrandName = managedBrand.brand.name.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );

    try {
      await adminPage.goto(`/brands/${managedBrand.slug}`, {
        waitUntil: "domcontentloaded",
      });
      await adminPage.getByRole("button", { name: "管理選單" }).click();
      await adminPage.getByRole("menuitem", { name: "編輯欄位" }).click();

      // Every assertion that waits on an /admin/brands render carries an
      // explicit timeout: that page takes 5-6.5s to respond under CI load, so
      // the 5s expect default is a coin flip. Matches the explicit 15s waits in
      // the sibling test above (DEV-1312).
      await expect(adminPage).toHaveURL(
        new RegExp(`/admin/brands\\?edit=${managedBrand.brand.id}$`),
        { timeout: ADMIN_NAV_TIMEOUT },
      );
      const detailPanel = adminPage.getByRole("dialog", {
        name: managedBrand.brand.name,
      });
      await expect(detailPanel).toBeVisible({ timeout: ADMIN_NAV_TIMEOUT });
      const contentSection = detailPanel
        .getByRole("heading", { name: "Content", exact: true })
        .locator("xpath=ancestor::section[1]");
      await contentSection.getByRole("button", { name: "Edit" }).click();
      await expect(contentSection.getByLabel("Brand name")).toHaveValue(
        managedBrand.brand.name,
      );
      await detailPanel.getByRole("button", { name: "Close dialog" }).click();

      await adminPage.goto(
        `/admin/brands?search=${encodeURIComponent(managedBrand.brand.name)}`,
      );
      const catalogRow = adminPage.getByRole("row", {
        name: new RegExp(escapedBrandName),
      });
      await expect(
        catalogRow.getByRole("button", { name: "Edit" }),
      ).toHaveCount(0);
      await catalogRow
        .getByText(managedBrand.brand.name, { exact: true })
        .click();
      await expect(
        adminPage.getByRole("dialog", { name: managedBrand.brand.name }),
      ).toBeVisible({ timeout: ADMIN_NAV_TIMEOUT });

      await adminPage.goto(`/brands/${managedBrand.slug}`, {
        waitUntil: "domcontentloaded",
      });
      await adminPage.getByRole("button", { name: "管理選單" }).click();
      await adminPage.getByRole("menuitem", { name: "隱藏品牌" }).click();

      await expect(adminPage).toHaveURL(
        /\/admin\/brands\?status=hidden&search=/,
        { timeout: ADMIN_NAV_TIMEOUT },
      );
      const brandRow = adminPage.getByRole("row", {
        name: new RegExp(escapedBrandName),
      });
      await expect(brandRow).toContainText("Hidden", {
        timeout: ADMIN_NAV_TIMEOUT,
      });
    } finally {
      await managedBrand.cleanup();
    }
  });
});
