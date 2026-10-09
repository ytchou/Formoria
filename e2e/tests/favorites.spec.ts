import path from "node:path";

import type { Page } from "@playwright/test";

import { applyOriginGuard, test, expect } from "../fixtures/auth";
import { BUDGET, POLL } from "../budgets";
import { writeAuthStorageStateForCredentials } from "../helpers/auth-session";
import { getServiceClient, seedBrand, type SeededBrand } from "../helpers/seed";
import { addDeepStagingSessionCookie } from "../helpers/staging-session";
import { waitForViewerReady } from "../helpers/viewer-ready";

/**
 * Favorites journey: a visitor saves a brand and finds it again on /favorites.
 *
 * The visitor is an account this spec creates and deletes itself. The worker's
 * shared `isolatedUser` fixture is not safe here: auth-password-reset.spec.ts
 * changes that user's password, and a spec scheduled after it in the same
 * worker then inherits a dead session. `brand_saves` cascades on both the user
 * and the brand, so deleting both leaves nothing behind.
 */
test.describe("Favorites", () => {
  test.describe.configure({ mode: "serial" });

  let seeded: SeededBrand;
  let visitor: { id: string; email: string; password: string };
  let storageStatePath: string;

  test.beforeAll(async ({}, workerInfo) => {
    seeded = await seedBrand({
      name: "favorites",
      status: "approved",
      workerIndex: workerInfo.workerIndex,
      withLinks: true,
    });

    const suffix = `${Date.now()}-${workerInfo.workerIndex}`;
    const email = `e2e-favorites-${suffix}@test.local`;
    const password = `Favorites${suffix}A!`;
    const { data, error } = await getServiceClient().auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(
        `Failed to create favorites visitor: ${error?.message ?? "missing user"}`,
      );
    }
    visitor = { id: data.user.id, email, password };
    storageStatePath = path.join(
      workerInfo.project.outputDir,
      `favorites-${suffix}.json`,
    );
    await writeAuthStorageStateForCredentials(
      email,
      password,
      storageStatePath,
      "favorites visitor",
    );
  });

  test.afterAll(async () => {
    await seeded.cleanup();
    const { error } = await getServiceClient().auth.admin.deleteUser(
      visitor.id,
    );
    if (error && error.code !== "user_not_found") {
      throw new Error(
        `[e2e-cleanup] favorites visitor deletion failed: ${error.message}`,
      );
    }
  });

  // The save control updates optimistically and fires the toggle Server Action
  // in the background. Navigating away before that POST settles aborts it, so a
  // spec that clicks and immediately reloads /favorites races its own write.
  // The toggle is the only action whose body carries the brand id.
  const clickAndAwaitToggle = async (
    page: Page,
    click: () => Promise<void>,
  ) => {
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          "next-action" in r.request().headers() &&
          (r.request().postData() ?? "").includes(seeded.brand.id),
        { timeout: BUDGET.INTERACTIVE },
      ),
      click(),
    ]);
    expect(response.status()).toBe(200);
  };

  test("a saved brand appears on the favorites page and leaves it when unsaved", async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(BUDGET.TEST.MUTATION);
    const context = await browser.newContext({
      storageState: storageStatePath,
    });
    await addDeepStagingSessionCookie(context, baseURL);
    await applyOriginGuard(context, baseURL);
    const page = await context.newPage();

    try {
      const brandName = seeded.brand.name;
      const save = page.getByRole("button", {
        name: "收藏這個品牌",
        exact: true,
      });
      const unsave = page.getByRole("button", {
        name: "取消收藏這個品牌",
        exact: true,
      });

      // Fresh account: nothing saved yet. The first protected request after
      // sign-in is occasionally bounced to /auth/sign-in?next=/favorites on
      // staging (the transient redirect submit-funnel.spec.ts also notes), so
      // the load sits inside the retry. A persistent bounce still fails here,
      // with the sign-in page in the report.
      await expect(async () => {
        await page.goto("/favorites");
        await expect(
          page.getByRole("heading", { name: "還沒有收藏的品牌" }),
        ).toBeVisible({ timeout: BUDGET.RENDERED });
      }).toPass(POLL.UI);

      // Save from the brand page.
      await page.goto(`/brands/${seeded.slug}`);
      await waitForViewerReady(page);
      await expect(save).toBeEnabled({ timeout: BUDGET.INTERACTIVE });
      await clickAndAwaitToggle(page, () => save.click());
      await expect(unsave).toBeVisible({ timeout: BUDGET.INTERACTIVE });

      // Reading it back through a fresh page load is what proves it persisted.
      await expect(async () => {
        await page.goto("/favorites");
        await expect(page.getByRole("link", { name: brandName })).toBeVisible({
          timeout: BUDGET.RENDERED,
        });
      }).toPass(POLL.UI);

      // Back on the brand, it still shows as saved; unsave, then the list is
      // empty again.
      await page.goto(`/brands/${seeded.slug}`);
      await waitForViewerReady(page);
      await expect(unsave).toBeVisible({ timeout: BUDGET.INTERACTIVE });
      await clickAndAwaitToggle(page, () => unsave.click());
      await expect(save).toBeVisible({ timeout: BUDGET.INTERACTIVE });
      await expect(async () => {
        await page.goto("/favorites");
        await expect(
          page.getByRole("heading", { name: "還沒有收藏的品牌" }),
        ).toBeVisible({ timeout: BUDGET.RENDERED });
      }).toPass(POLL.UI);
      await expect(page.getByRole("link", { name: brandName })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("an anonymous save explains sign-in, then applies the save after signing in", async ({
    anonPage,
  }) => {
    test.setTimeout(BUDGET.TEST.MUTATION);
    const page = anonPage;

    await page.goto(`/brands/${seeded.slug}`);
    const save = page.getByRole("button", {
      name: "收藏這個品牌",
      exact: true,
    });
    // Enabled before the viewer settles: a click is queued, never dropped.
    await expect(save).toBeEnabled({ timeout: BUDGET.INTERACTIVE });
    await waitForViewerReady(page);
    await save.click();

    // The click opens a prompt with the reason instead of redirecting.
    const prompt = page.getByRole("alertdialog", {
      name: "登入後就能收藏，之後在「收藏品牌」找得到。",
    });
    await expect(prompt).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await prompt.getByRole("button", { name: "先不用", exact: true }).click();
    await expect(prompt).toBeHidden({ timeout: BUDGET.INTERACTIVE });
    await expect(page).toHaveURL(new RegExp(`/brands/${seeded.slug}$`));

    await save.click();
    await prompt.getByRole("button", { name: "登入", exact: true }).click();
    await expect(page).toHaveURL(/\/auth\/sign-in\?reason=save/, {
      timeout: BUDGET.NAVIGATION,
    });
    await page.getByLabel("電子郵件", { exact: true }).fill(visitor.email);
    await page.getByLabel("密碼", { exact: true }).fill(visitor.password);
    await page.getByRole("button", { name: "登入", exact: true }).click();

    // Signing in lands on the brand again, and the save asked for before
    // sign-in is applied once, with a confirmation.
    await expect(page).toHaveURL(new RegExp(`/brands/${seeded.slug}$`), {
      timeout: BUDGET.NAVIGATION,
    });
    await waitForViewerReady(page);
    await expect(
      page.getByRole("button", { name: "取消收藏這個品牌", exact: true }),
    ).toBeVisible({ timeout: BUDGET.INTERACTIVE });
    await expect(page.getByText("已收藏", { exact: true })).toBeVisible({
      timeout: BUDGET.INTERACTIVE,
    });
    await expect(async () => {
      await page.goto("/favorites");
      await expect(
        page.getByRole("link", { name: seeded.brand.name }),
      ).toBeVisible({ timeout: BUDGET.RENDERED });
    }).toPass(POLL.UI);
  });
});
