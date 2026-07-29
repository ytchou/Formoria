import { test, expect } from "../fixtures/auth";
import { seedBrand, type SeededBrand } from "../helpers/seed";

/**
 * Public brand actions and admin placement.
 *
 * These journeys exercise the controls that sit beside a brand name on the
 * detail page: anonymous support, evidence sign-in guidance, and the admin
 * menu's position in the heading row.
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

  test("anonymous visitor sees sign-in guidance before submitting evidence", async ({
    anonPage,
  }) => {
    const response = await anonPage.goto(`/brands/${seeded.slug}`, {
      waitUntil: "domcontentloaded",
    });
    if (response?.status() === 503) {
      test.skip(true, "PREVIEW_MODE active — skipping.");
      return;
    }

    const evidenceTrigger = anonPage.getByRole("button", {
      name: "回報產地資訊",
    });
    await expect(evidenceTrigger).toBeVisible({ timeout: 15_000 });
    await expect(evidenceTrigger).toHaveAttribute(
      "title",
      "請先登入，再提供產地證據。",
      { timeout: 15_000 },
    );
    await evidenceTrigger.click();

    // The evidence body is a next/dynamic chunk behind a loading skeleton whose
    // accessible name is the loading label, so this name-scoped locator only
    // matches once the chunk has landed — a slow open, not a broken dialog.
    const dialog = anonPage.getByRole("dialog", { name: "提供產地證據" });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toContainText("請先登入，再提供產地證據。");
    await expect(dialog.getByRole("link", { name: "登入" })).toHaveAttribute(
      "href",
      /\/auth\/sign-in\?next=/,
    );

    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(dialog).not.toBeVisible();
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
});
