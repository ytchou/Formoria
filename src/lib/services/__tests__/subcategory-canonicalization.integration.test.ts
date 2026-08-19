import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createServiceClient } from "@/lib/supabase/service";
import { describeWithDb } from "@/test/setup";
import { canonicalizeSubcategorySlugs } from "../enrich-phases/descriptions";

/**
 * Replaces `subcategory-translations.integration.test.ts`. That suite asserted
 * the old label-keyed contract — first English translation ever seen for a
 * zh-TW label wins, cached in `subcategory_translations` — and DEV-1510 Task 7
 * dropped both the table and the RPC that owned it.
 *
 * The property worth keeping is the one that bug was about: two brands must
 * not end up with different English names for the same subcategory. The
 * mechanism moved from "first writer wins" to "the closed vocabulary decides",
 * which is stronger, because it no longer depends on which brand was enriched
 * first.
 */
const supabase =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createServiceClient()
    : null;

describeWithDb("canonical subcategory name RPC", () => {
  // Bug caught: the enrichment phase writing whatever English the model
  // produced this run, so `backpacks` reads as "Backpacks" on one brand and
  // "Back Packs" on the next.
  it("resolves the closed vocabulary and ignores the caller's translation", async () => {
    const result = await canonicalizeSubcategorySlugs(
      supabase!,
      ["backpacks", "tote-bags"],
      ["Back Packs", "Shopper Bags"],
    );
    expect(result).toEqual(["Backpacks", "Tote Bags"]);
  });

  // Bug caught: the inversion landing before the Task 9 backfill and losing
  // every row that still stores zh-TW labels. Slug and label must both resolve
  // to the same canonical English name during that window.
  it("resolves a stored zh-TW label to the same name as its slug", async () => {
    const result = await canonicalizeSubcategorySlugs(
      supabase!,
      ["後背包"],
      ["Back Packs"],
    );
    expect(result).toEqual(["Backpacks"]);
  });

  // Bug caught: a value outside the vocabulary being dropped or replaced with
  // a slug. Until Task 15 closes the pickers, novel strings still arrive, and
  // the caller's own translation is the only thing that can name them.
  it("falls back to the caller's translation outside the vocabulary", async () => {
    const novel = `未收錄品項-${randomUUID().slice(0, 8)}`;
    expect(
      await canonicalizeSubcategorySlugs(supabase!, [novel], ["Novel Kind"]),
    ).toEqual(["Novel Kind"]);
    // No translation supplied: the stored value is returned unchanged rather
    // than becoming null and blanking `subcategories_en`.
    expect(await canonicalizeSubcategorySlugs(supabase!, [novel], [])).toEqual([
      novel,
    ]);
  });

  it("returns an empty array for an empty input", async () => {
    expect(await canonicalizeSubcategorySlugs(supabase!, [], [])).toEqual([]);
  });
});
