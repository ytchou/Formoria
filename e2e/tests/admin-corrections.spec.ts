import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { test, expect } from "../fixtures/auth";
import { seedBrand, type SeededBrand } from "../helpers/seed";

import { BUDGET } from "../budgets";
test.describe("Admin brand corrections", () => {
  test.describe.configure({ mode: "serial" });

  let supabase: ReturnType<typeof createClient> | null = null;
  const seededBrands: SeededBrand[] = [];
  const correctionIds: string[] = [];

  test.beforeEach(() => {
    const adminEmail = process.env.E2E_ADMIN_EMAIL;
    const list = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim());
    test.skip(
      !adminEmail || !list.includes(adminEmail),
      "E2E_ADMIN_EMAIL not in ADMIN_EMAILS — admin tests require matching env",
    );
  });

  test.afterAll(async () => {
    if (supabase && correctionIds.length > 0) {
      await supabase
        .from("brand_field_corrections")
        .delete()
        .in("id", correctionIds);
    }
    for (const seeded of seededBrands) await seeded.cleanup();
  });

  test("renders the corrections heading and either a queue table or the empty state", async ({
    adminPage,
  }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    await adminPage.goto("/admin/corrections");
    await expect(adminPage.getByRole("heading", { name: "Brand Corrections" })).toBeVisible({
      timeout: BUDGET.NAVIGATION,
    });

    // Real visitor corrections may be pending in this environment, so the queue
    // is asserted as table-or-empty rather than pinned to one of the two.
    const table = adminPage.locator("table").first();
    const emptyState = adminPage.getByText("No pending brand corrections.");
    await expect(table.or(emptyState).first()).toBeVisible({ timeout: BUDGET.SERVER_RENDER });

    if (await table.isVisible()) {
      await expect(
        adminPage.getByRole("columnheader", { name: "Brand" }),
      ).toBeVisible();
      await expect(
        adminPage.getByRole("columnheader", { name: "Field" }),
      ).toBeVisible();
      await expect(
        adminPage.getByRole("columnheader", { name: "Current value" }),
      ).toBeVisible();
      await expect(
        adminPage.getByRole("columnheader", { name: "Proposed value" }),
      ).toBeVisible();
    }
  });

  test("opens correction details and approves only the selected rows", async ({ adminPage }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    test.skip(!url || !key, "Supabase service-role credentials are required for correction seeding.");
    supabase = createClient(url!, key!);

    try {
      for (const name of ["selected one", "selected two", "untouched"]) {
        seededBrands.push(
          await seedBrand({
            name: `corrections ${name}`,
            workerIndex: test.info().workerIndex,
            // `withFaqEvidence` is the only seed switch that writes
            // `price_range` (ordinal 2). Without it the column is NULL and the
            // "unselected row is untouched" assertion has nothing to compare.
            withFaqEvidence: true,
          }),
        );
      }
    } catch (error) {
      test.skip(true, `Skipped because correction seed could not be established: ${String(error)}`);
      return;
    }

    const proposedValues = [1, 3, 1];
    for (const [index, seeded] of seededBrands.entries()) {
      const { data: correction, error } = await supabase
        .from("brand_field_corrections")
        .insert({
          brand_id: seeded.brand.id,
          field: "price_range",
          previous_value: 2,
          proposed_value: proposedValues[index],
          visitor_hash: randomUUID(),
          status: "pending",
        })
        .select("id")
        .single();
      if (error || !correction?.id) {
        test.skip(true, `Skipped because correction insert failed: ${error?.message ?? "missing id"}`);
        return;
      }
      correctionIds.push(correction.id);
    }

    await adminPage.goto("/admin/corrections");
    await expect(adminPage.getByRole("heading", { name: "Brand Corrections" })).toBeVisible({
      timeout: BUDGET.NAVIGATION,
    });

    const selectedRow = adminPage
      .getByRole("row")
      .filter({ hasText: seededBrands[0].brand.name })
      .first();
    await expect(selectedRow).toBeVisible({ timeout: BUDGET.GATED_UI });
    await selectedRow
      .getByRole("button", { name: `Show details for ${seededBrands[0].brand.name}` })
      .click();

    const drawer = adminPage.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("Current value", { exact: true })).toBeVisible();
    await expect(drawer.getByText("Proposed value", { exact: true })).toBeVisible();
    await adminPage.keyboard.press("Escape");
    await expect(drawer).toBeHidden();

    for (const seeded of seededBrands.slice(0, 2)) {
      await adminPage
        .getByRole("row")
        .filter({ hasText: seeded.brand.name })
        .first()
        .getByRole("checkbox", { name: `Select ${seeded.brand.name}` })
        .click();
    }
    await adminPage.getByRole("button", { name: "Approve 2 selected" }).click();

    await expect
      .poll(async () => {
        const { data, error } = await supabase
          .from("brand_field_corrections")
          .select("id, status")
          .in("id", correctionIds);
        if (error) throw error;
        return new Map(data?.map((row) => [row.id, row.status]));
      })
      .toEqual(
        new Map([
          [correctionIds[0], "approved"],
          [correctionIds[1], "approved"],
          [correctionIds[2], "pending"],
        ]),
      );

    const { data: brands, error: brandsError } = await supabase
      .from("brands")
      .select("id, price_range")
      .in("id", seededBrands.map((seeded) => seeded.brand.id));
    expect(brandsError).toBeNull();
    expect(new Map(brands?.map((brand) => [brand.id, brand.price_range]))).toEqual(
      new Map([
        [seededBrands[0].brand.id, 1],
        [seededBrands[1].brand.id, 3],
        [seededBrands[2].brand.id, 2],
      ]),
    );

    await expect(
      adminPage.getByRole("row").filter({ hasText: seededBrands[2].brand.name }),
    ).toBeVisible();
  });
});
