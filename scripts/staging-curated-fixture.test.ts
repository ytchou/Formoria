import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const raw = readFileSync(
  resolve(
    import.meta.dirname,
    "../supabase/fixtures/staging-curated-products.sql",
  ),
  "utf8",
);
const fixture = raw.toLowerCase();

/**
 * Mirrors MIN_HOME_CURATED_PRODUCTS in src/lib/services/curated-products.ts.
 * Duplicated rather than imported: this file asserts on SQL text and must not
 * drag the service layer (and its Supabase types) into the test graph.
 */
const SUPPLY_FLOOR = 6;

/** One `values` row: id, brand_id, key, name_zh, l1, urls, description. */
const PRODUCT_ID = /'53000000-0000-4000-8000-\d{12}'::uuid/g;
/** `'key', 'name_zh', 'l1',` — the l1 literal is the third on that line. */
const CATEGORY = /'[a-z0-9-]+', '[^']+', '([a-z-]+)',/g;
/** `'description。', product_position, wall_position` — the last row line. */
const DESCRIPTION = /\n {6}'([^']*。)', (?:\d+|null), (\d+|null)\n/g;

const productIds = new Set(fixture.match(PRODUCT_ID) ?? []);
const rows = [...raw.matchAll(DESCRIPTION)];
const descriptions = rows.map(([, value]) => value);
const wallPositions = rows.map(([, , wallPosition]) => wallPosition);

describe("staging curated-product fixture contract", () => {
  it("seeds enough products to clear the homepage supply floor", () => {
    // Margin over the floor, not a full wall: the wall is meant to show real
    // authored products, and this fixture is only CI/staging supply.
    expect(productIds.size).toBeGreaterThanOrEqual(SUPPLY_FLOOR + 4);
    expect(productIds.size).toBeLessThanOrEqual(14);
  });

  it("pins no fixture product to the wall", () => {
    // Synthetic CI supply must never lead the homepage wall: a pin sorts ahead
    // of the daily shuffle, and those slots belong to hand-authored products.
    // The file header states this; without an assertion a stray pin ships.
    expect(wallPositions).toHaveLength(productIds.size);
    expect(new Set(wallPositions)).toEqual(new Set(["null"]));
  });

  it("gives every fixture product a zh description", () => {
    // product_description_zh is NOT NULL since 20260818120000; a row that
    // omitted it would fail the seed, not render an empty tile.
    expect(descriptions).toHaveLength(productIds.size);
    for (const description of descriptions) {
      expect(description).toBe(description.trim());
      expect(description.length).toBeGreaterThan(0);
    }
  });

  it("seeds only in-boundary categories", () => {
    const categories = [...raw.matchAll(CATEGORY)].map(([, l1]) => l1);
    expect(categories).toHaveLength(productIds.size);
    expect(new Set(categories)).toEqual(
      new Set(["home", "crafts", "stationery"]),
    );
  });

  it("keeps three write targets", () => {
    // products, sources, selections — each idempotent.
    expect(fixture.match(/^insert into/gm)).toHaveLength(3);
    expect(fixture.match(/on conflict \([^)]+\) do update/g)).toHaveLength(3);

    const writeTargets = Array.from(
      fixture.matchAll(/^(?:insert into|update|delete from)\s+([a-z_.]+)/gm),
      (match) => match[1],
    );
    expect(new Set(writeTargets)).toEqual(
      new Set([
        "public.curated_products",
        "public.curated_product_sources",
        "public.curated_product_selections",
      ]),
    );
  });

  it("references no dropped column", () => {
    for (const dropped of ["highlight_rationale", "notes_zh", "rationale_zh"]) {
      expect(fixture).not.toContain(dropped);
    }
  });

  it("never touches private columns or tables", () => {
    for (const prohibited of [
      "auth.users",
      "public.profiles",
      "brand_owners",
      "brand_submissions",
      "contact_email",
      "admin_audit_log",
      "visitor_hash",
      "app_secrets",
      "storage.objects",
    ]) {
      expect(fixture).not.toContain(prohibited);
    }
  });

  it("clears the homepage publication gate", () => {
    // getPublishedCuratedProductsForHomepage silently drops rows failing any
    // of these, and the homepage hides the whole wall below the supply floor.
    for (const required of [
      "'published'",
      "'permitted'",
      "source_checked_at",
      "'active'",
    ]) {
      expect(fixture).toContain(required);
    }
  });

  it("only references images next/image is allowed to render", () => {
    const imageUrls = raw.match(/https:\/\/\S+\/storage\/v1\/\S+?\.webp/g) ?? [];
    expect(imageUrls).toHaveLength(productIds.size);
    expect(new Set(imageUrls).size).toBe(productIds.size);
    for (const url of imageUrls) {
      expect(new URL(url).hostname.endsWith(".supabase.co")).toBe(true);
    }
  });

  it("leaves image dimensions unmeasured, so every tile falls back to 4:3", () => {
    // `image_width` / `image_height` are nullable by design: NULL is the
    // backfill cursor. The fixture writes neither, so the staging wall renders
    // entirely at DEFAULT_WALL_RATIO until the backfill runs — which is the
    // state the ratio fallback exists to survive, not a gap in the fixture.
    expect(fixture).not.toContain("image_width");
    expect(fixture).not.toContain("image_height");
  });
});
