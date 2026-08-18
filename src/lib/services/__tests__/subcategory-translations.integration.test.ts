import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { createServiceClient } from "@/lib/supabase/service";
import { describeWithDb } from "@/test/setup";
import { canonicalizeSubcategoryTranslations } from "../enrich-phases/descriptions";

const supabase =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createServiceClient()
    : null;

describeWithDb("canonical subcategory translation RPC", () => {
  const seededKeys: string[] = [];

  afterEach(async () => {
    if (seededKeys.length === 0) return;

    // Bridge-only cleanup: application code calls the final RPC; PR3 removes
    // this direct legacy-table cleanup with the compatibility table itself.
    await supabase!
      .from("product_tag_translations")
      .delete()
      .in("tag_zh", seededKeys);
    seededKeys.length = 0;
  });

  // Bug caught: moving the enrichment caller without a bridge would either
  // drop canonical translations during mixed-version deploys or let duplicate
  // rows replace the first canonical translation.
  it("keeps the first canonical translation and ignores duplicate inputs", async () => {
    const suffix = randomUUID().slice(0, 8);
    const firstSubcategory = `測試子類別-${suffix}`;
    const secondSubcategory = `另一個子類別-${suffix}`;
    seededKeys.push(firstSubcategory, secondSubcategory);

    const firstResult = await canonicalizeSubcategoryTranslations(
      supabase!,
      [firstSubcategory, firstSubcategory, secondSubcategory],
      ["First English", "Ignored English", "Second English"],
    );
    expect(firstResult).toEqual([
      "First English",
      "First English",
      "Second English",
    ]);

    const repeatResult = await canonicalizeSubcategoryTranslations(
      supabase!,
      [firstSubcategory],
      ["Replacement English"],
    );
    expect(repeatResult).toEqual(["First English"]);
  });
});
