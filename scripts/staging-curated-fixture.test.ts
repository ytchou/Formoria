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

/** Ideographic full stop; every rationale literal ends with one. */
const SENTENCE_END = "。";

describe("staging curated-product fixture contract", () => {
  it("seeds ninety products across thirty brands staging.sql already owns", () => {
    const products = new Set(
      fixture.match(/'53000000-0000-4000-8000-\d{12}'/g) ?? [],
    );
    expect(products.size).toBe(90);

    const brands = fixture.match(/'51000000-0000-4000-8000-(\d{12})'/g) ?? [];
    expect(new Set(brands).size).toBe(30);
    for (const brand of brands) {
      const ordinal = Number(brand.slice(-13, -1));
      expect(ordinal).toBeGreaterThanOrEqual(1);
      expect(ordinal).toBeLessThanOrEqual(40);
    }
  });

  it("gives every brand exactly three products", () => {
    const perBrand = new Map<string, number>();
    for (const [, brand] of raw.matchAll(
      /'53000000-0000-4000-8000-\d{12}'::uuid,\s*\n\s*'(51000000-0000-4000-8000-\d{12})'::uuid/g,
    )) {
      perBrand.set(brand, (perBrand.get(brand) ?? 0) + 1);
    }
    expect(perBrand.size).toBe(30);
    for (const count of perBrand.values()) expect(count).toBe(3);
  });

  it("keeps every product key unique inside its brand", () => {
    const pairs = [
      ...raw.matchAll(
        /'(51000000-0000-4000-8000-\d{12})'::uuid,\s*\n\s*'([a-z0-9-]+)',/g,
      ),
    ].map(([, brand, key]) => `${brand}/${key}`);
    expect(pairs).toHaveLength(90);
    expect(new Set(pairs).size).toBe(90);
  });

  it("writes only the curated-product tables and never private columns", () => {
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

  it("is idempotent on every statement", () => {
    expect(fixture.match(/^insert into/gm)).toHaveLength(3);
    expect(fixture.match(/on conflict \([^)]+\) do update/g)).toHaveLength(3);
  });

  it("clears the homepage publication gate", () => {
    // getPublishedCuratedProductsForHomepage silently drops rows failing any
    // of these, and the homepage hides the whole wall below six survivors.
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
    expect(imageUrls).toHaveLength(90);
    expect(new Set(imageUrls).size).toBe(90);
    for (const url of imageUrls) {
      expect(new URL(url).hostname.endsWith(".supabase.co")).toBe(true);
    }
  });

  it("keeps every rationale renderable as a data attribute", () => {
    // selected-product-tile writes the rationale into both the attribute and
    // the text node; the e2e spec asserts they match and are already trimmed.
    const rationales =
      raw.match(new RegExp(`'[^']*${SENTENCE_END}'`, "g")) ?? [];
    expect(rationales.length).toBeGreaterThanOrEqual(90);
    for (const rationale of rationales) {
      const value = rationale.slice(1, -1);
      expect(value).toBe(value.trim());
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it("pins eight products ahead of the daily shuffle and leaves the rest free", () => {
    // Anchor spans are gone — every tile is now equal and the rhythm comes
    // from ratio variety. `wall_position` survives only as an editorial pin:
    // pinned rows sort ahead of the date-seeded remainder, so eight of them is
    // what exercises the pinned/unpinned split without freezing the wall.
    const pinned = raw.match(/, (\d+)\n\s+\)/g) ?? [];
    expect(pinned).toHaveLength(8);
    expect(new Set(pinned.map((line) => line.match(/\d+/)?.[0])).size).toBe(8);
    expect(raw.match(/, null\n\s+\)/g)).toHaveLength(82);
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
