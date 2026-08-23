import { test, expect } from "../fixtures/auth";
import { BUDGET } from "../budgets";
import { seedBrand, type SeededBrand } from "../helpers/seed";
import { waitForViewerReady } from "../helpers/viewer-ready";

/**
 * Public brand actions and admin placement.
 *
 * These journeys exercise the controls that sit beside a brand name on the
 * detail page: the admin menu's placement in the heading row.
 */

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

  test("admin menu renders in the brand heading row", async ({ adminPage }) => {
    const response = await adminPage.goto(`/brands/${seeded.slug}`, {
      waitUntil: "domcontentloaded",
    });
    if (response?.status() === 503) {
      test.skip(true, "PREVIEW_MODE active — skipping.");
      return;
    }

    // The menu renders `null` until viewer context resolves, so without this
    // gate a missing button and a slow one are the same observable failure.
    // After it, RENDERED is the right budget: the button exists or it is broken.
    await waitForViewerReady(adminPage);

    const heading = adminPage.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible({ timeout: BUDGET.RENDERED });

    // Containment, not coordinates. This used to compare boundingBox() x/y with
    // a 12px tolerance, read after `domcontentloaded` — i.e. layout geometry
    // sampled mid-settle, which is pixel styling rather than behaviour and flaked
    // accordingly (DEV-1414). The invariant that actually matters is that the
    // menu sits in the heading row beside the name, not elsewhere on the page.
    const headingRow = heading.locator("xpath=..");
    await expect(
      headingRow.getByRole("button", { name: "管理選單" }),
    ).toBeVisible({ timeout: BUDGET.RENDERED });
  });

  test("admin can edit and hide the selected brand from its detail menu", async ({
    adminPage,
  }, workerInfo) => {
    // This test walks brand detail → admin edit dialog → admin catalog → brand
    // detail → hide; each admin navigation costs 4-6.5s, so the journey alone
    // needs ~30s of server time. Under the 30s CI default it died at whichever
    // step drained the budget — the edit dialog in one run, the post-hide
    // redirect in the next — which read as two unrelated bugs (DEV-1312). The
    // per-assertion budgets below are the other half: expect() has its own 5s
    // default that the test budget does not lift.
    test.setTimeout(BUDGET.TEST.ADMIN);

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
      await waitForViewerReady(adminPage);
      await adminPage.getByRole("button", { name: "管理選單" }).click();
      await adminPage.getByRole("menuitem", { name: "編輯欄位" }).click();

      // Every assertion that waits on an /admin/brands render carries an
      // explicit budget: that page takes 5-6.5s to respond under CI load, so
      // the 5s expect default is a coin flip (DEV-1312).
      await expect(adminPage).toHaveURL(
        new RegExp(`/admin/brands\\?edit=${managedBrand.brand.id}$`),
        { timeout: BUDGET.GATED_UI },
      );
      const detailPanel = adminPage.getByRole("dialog", {
        name: managedBrand.brand.name,
      });
      await expect(detailPanel).toBeVisible({ timeout: BUDGET.GATED_UI });
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
      ).toBeVisible({ timeout: BUDGET.GATED_UI });

      await adminPage.goto(`/brands/${managedBrand.slug}`, {
        waitUntil: "domcontentloaded",
      });
      await waitForViewerReady(adminPage);
      await adminPage.getByRole("button", { name: "管理選單" }).click();
      await adminPage.getByRole("menuitem", { name: "隱藏品牌" }).click();

      await expect(adminPage).toHaveURL(
        /\/admin\/brands\?status=hidden&search=/,
        { timeout: BUDGET.GATED_UI },
      );
      const brandRow = adminPage.getByRole("row", {
        name: new RegExp(escapedBrandName),
      });
      await expect(brandRow).toContainText("Hidden", {
        timeout: BUDGET.GATED_UI,
      });
    } finally {
      await managedBrand.cleanup();
    }
  });
});
