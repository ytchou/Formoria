import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { createTestClient, describeWithDb } from "@/test/setup";
import { getPublishedCuratedProductsForBrand } from "../curated-products";

type SeedProduct = {
  key: string;
  lifecycle?: string;
  officialUrl?: string | null;
  sourceCheckedAt?: string | null;
  linkState?: string;
  sources?: number;
  /** The planner retires rather than deletes, so a source row can be dead. */
  sourceState?: "active" | "retired";
  selections?: {
    trailSlug: string;
    sectionKey?: string;
    position: number;
    rationaleZh?: string;
    state?: "active" | "retired";
  }[];
};

describeWithDb("published curated products for a brand", () => {
  const supabase = (
    process.env.RUN_SUPABASE_INTEGRATION_TESTS === "true"
      ? createTestClient()
      : null
  )!;
  const brandIds: string[] = [];

  afterEach(async () => {
    if (brandIds.length > 0) {
      // Products, sources, and selections all cascade from the brand row.
      await supabase.from("brands").delete().in("id", brandIds);
      brandIds.length = 0;
    }
  });

  async function seedBrand(products: SeedProduct[]): Promise<string> {
    const brandId = randomUUID();
    brandIds.push(brandId);
    const suffix = brandId.slice(0, 8);

    const { error: brandError } = await supabase.from("brands").insert({
      id: brandId,
      name: `Curated Products Fixture ${suffix}`,
      slug: `curated-products-fixture-${suffix}`,
      status: "approved",
    });
    expect(brandError).toBeNull();

    for (const product of products) {
      const productId = randomUUID();
      const { error: productError } = await supabase
        .from("curated_products")
        .insert({
          id: productId,
          brand_id: brandId,
          key: product.key,
          name_zh: `Fixture ${product.key}`,
          name_en: `Fixture ${product.key}`,
          l1: "home",
          l2: ["tableware"],
          official_url:
            product.officialUrl === undefined
              ? `https://example.com/${suffix}/${product.key}`
              : product.officialUrl,
          lifecycle: product.lifecycle ?? "published",
          link_state: product.linkState ?? "ok",
          source_checked_at:
            product.sourceCheckedAt === undefined
              ? new Date().toISOString()
              : product.sourceCheckedAt,
        });
      expect(productError).toBeNull();

      const sourceCount = product.sources ?? 1;
      for (let index = 0; index < sourceCount; index += 1) {
        const { error: sourceError } = await supabase
          .from("curated_product_sources")
          .insert({
            product_id: productId,
            url: `https://example.com/${suffix}/${product.key}/source-${index}`,
            source_type: "official",
            claim_zh: `Claim ${index}`,
            state: product.sourceState ?? "active",
          });
        expect(sourceError).toBeNull();
      }

      for (const selection of product.selections ?? []) {
        const { error: selectionError } = await supabase
          .from("curated_product_selections")
          .insert({
            product_id: productId,
            trail_slug: selection.trailSlug,
            section_key: selection.sectionKey ?? "picks",
            position: selection.position,
            rationale_zh:
              selection.rationaleZh ??
              `Rationale ${selection.trailSlug} ${selection.position}`,
            state: selection.state ?? "active",
          });
        expect(selectionError).toBeNull();
      }
    }

    return brandId;
  }

  it("returns published products for a brand, ordered by selection position", async () => {
    const brandId = await seedBrand([
      {
        key: "second-pick",
        selections: [{ trailSlug: "gifting", position: 2 }],
      },
      {
        key: "first-pick",
        selections: [{ trailSlug: "gifting", position: 1 }],
      },
    ]);

    const products = await getPublishedCuratedProductsForBrand(
      brandId,
      supabase,
    );

    expect(products.map((product) => product.key)).toEqual([
      "first-pick",
      "second-pick",
    ]);
    const first = products.at(0);
    expect(first?.nameZh).toBe("Fixture first-pick");
    expect(first?.l1).toBe("home");
    expect(first?.l2).toEqual(["tableware"]);
    expect(first?.trailSlug).toBe("gifting");
    expect(first?.sectionKey).toBe("picks");
    expect(first?.position).toBe(1);
    expect(first?.rationaleZh).toBe("Rationale gifting 1");
    expect(first?.officialUrl).toContain("first-pick");
    expect(first?.linkState).toBe("ok");
  });

  it("omits products whose lifecycle is not published", async () => {
    const brandId = await seedBrand([
      {
        key: "live-pick",
        selections: [{ trailSlug: "gifting", position: 1 }],
      },
      {
        key: "candidate-pick",
        lifecycle: "candidate",
        selections: [{ trailSlug: "gifting", position: 2 }],
      },
      {
        key: "needs-review-pick",
        lifecycle: "needs_review",
        selections: [{ trailSlug: "gifting", position: 3 }],
      },
      {
        key: "retired-pick",
        lifecycle: "retired",
        selections: [{ trailSlug: "gifting", position: 4 }],
      },
    ]);

    const products = await getPublishedCuratedProductsForBrand(
      brandId,
      supabase,
    );

    expect(products.map((product) => product.key)).toEqual(["live-pick"]);
  });

  it("omits published products with no evidence source row", async () => {
    const brandId = await seedBrand([
      {
        key: "sourced-pick",
        selections: [{ trailSlug: "gifting", position: 1 }],
      },
      {
        key: "unsourced-pick",
        sources: 0,
        selections: [{ trailSlug: "gifting", position: 2 }],
      },
    ]);

    const products = await getPublishedCuratedProductsForBrand(
      brandId,
      supabase,
    );

    expect(products.map((product) => product.key)).toEqual(["sourced-pick"]);
  });

  it("omits a published product whose every source is retired", async () => {
    // Retire-never-delete means the source ROW survives withdrawal, so row
    // presence is not evidence — only an active row is.
    const brandId = await seedBrand([
      {
        key: "live-source-pick",
        selections: [{ trailSlug: "gifting", position: 1 }],
      },
      {
        key: "withdrawn-source-pick",
        sourceState: "retired",
        selections: [{ trailSlug: "gifting", position: 2 }],
      },
    ]);

    const products = await getPublishedCuratedProductsForBrand(
      brandId,
      supabase,
    );

    expect(products.map((product) => product.key)).toEqual([
      "live-source-pick",
    ]);
  });

  it("ignores a retired selection when choosing the winning one", async () => {
    const brandId = await seedBrand([
      {
        key: "repositioned-pick",
        selections: [
          {
            trailSlug: "everyday",
            position: 1,
            rationaleZh: "Withdrawn angle",
            state: "retired",
          },
          { trailSlug: "gifting", position: 3, rationaleZh: "Live angle" },
        ],
      },
    ]);

    const products = await getPublishedCuratedProductsForBrand(
      brandId,
      supabase,
    );

    expect(products).toHaveLength(1);
    expect(products.at(0)?.trailSlug).toBe("gifting");
    expect(products.at(0)?.position).toBe(3);
    expect(products.at(0)?.rationaleZh).toBe("Live angle");
  });

  it("still returns a product whose every selection is retired", async () => {
    // A product with no live placement sorts last with a null rationale; it is
    // never dropped, because placement is presentation and not proof.
    const brandId = await seedBrand([
      {
        key: "unplaced-pick",
        selections: [
          {
            trailSlug: "gifting",
            position: 1,
            rationaleZh: "Withdrawn angle",
            state: "retired",
          },
        ],
      },
      {
        key: "placed-pick",
        selections: [{ trailSlug: "gifting", position: 5 }],
      },
    ]);

    const products = await getPublishedCuratedProductsForBrand(
      brandId,
      supabase,
    );

    expect(products.map((product) => product.key)).toEqual([
      "placed-pick",
      "unplaced-pick",
    ]);
    const unplaced = products.at(1);
    expect(unplaced?.position).toBeNull();
    expect(unplaced?.rationaleZh).toBeNull();
    expect(unplaced?.trailSlug).toBeNull();
  });

  it("omits published products with a null source_checked_at", async () => {
    const brandId = await seedBrand([
      {
        key: "checked-pick",
        selections: [{ trailSlug: "gifting", position: 1 }],
      },
      {
        key: "unchecked-pick",
        sourceCheckedAt: null,
        selections: [{ trailSlug: "gifting", position: 2 }],
      },
    ]);

    const products = await getPublishedCuratedProductsForBrand(
      brandId,
      supabase,
    );

    expect(products.map((product) => product.key)).toEqual(["checked-pick"]);
  });

  it("returns a product whose link_state is broken, flagged for CTA suppression", async () => {
    const brandId = await seedBrand([
      {
        key: "broken-link-pick",
        linkState: "broken",
        selections: [{ trailSlug: "gifting", position: 1 }],
      },
    ]);

    const products = await getPublishedCuratedProductsForBrand(
      brandId,
      supabase,
    );

    expect(products).toHaveLength(1);
    expect(products.at(0)?.key).toBe("broken-link-pick");
    expect(products.at(0)?.linkState).toBe("broken");
  });

  it("returns one card per product when a product belongs to two trails", async () => {
    const brandId = await seedBrand([
      {
        key: "shared-pick",
        selections: [
          { trailSlug: "gifting", position: 3, rationaleZh: "Gifting angle" },
          { trailSlug: "everyday", position: 1, rationaleZh: "Everyday angle" },
        ],
      },
    ]);

    const products = await getPublishedCuratedProductsForBrand(
      brandId,
      supabase,
    );

    expect(products).toHaveLength(1);
    // The lowest-position selection supplies the rationale shown on the card.
    expect(products.at(0)?.trailSlug).toBe("everyday");
    expect(products.at(0)?.position).toBe(1);
    expect(products.at(0)?.rationaleZh).toBe("Everyday angle");
  });

  it("breaks a position tie by trail_slug alphabetically", async () => {
    const brandId = await seedBrand([
      {
        key: "tied-pick",
        selections: [
          { trailSlug: "zesty", position: 1, rationaleZh: "Zesty angle" },
          { trailSlug: "artisan", position: 1, rationaleZh: "Artisan angle" },
        ],
      },
    ]);

    const products = await getPublishedCuratedProductsForBrand(
      brandId,
      supabase,
    );

    expect(products).toHaveLength(1);
    expect(products.at(0)?.trailSlug).toBe("artisan");
    expect(products.at(0)?.rationaleZh).toBe("Artisan angle");
  });

  it("returns an empty array for a brand with no curated products", async () => {
    const brandId = await seedBrand([]);

    const products = await getPublishedCuratedProductsForBrand(
      brandId,
      supabase,
    );

    expect(products).toEqual([]);
  });

  it("cascades on brand delete", async () => {
    const brandId = await seedBrand([
      {
        key: "cascade-pick",
        selections: [{ trailSlug: "gifting", position: 1 }],
      },
    ]);

    const { data: seeded } = await supabase
      .from("curated_products")
      .select("id")
      .eq("brand_id", brandId);
    expect(seeded).toHaveLength(1);
    const productId = seeded?.at(0)?.id as string;

    const { error: deleteError } = await supabase
      .from("brands")
      .delete()
      .eq("id", brandId);
    expect(deleteError).toBeNull();
    brandIds.length = 0;

    const { data: products } = await supabase
      .from("curated_products")
      .select("id")
      .eq("brand_id", brandId);
    const { data: sources } = await supabase
      .from("curated_product_sources")
      .select("id")
      .eq("product_id", productId);
    const { data: selections } = await supabase
      .from("curated_product_selections")
      .select("product_id")
      .eq("product_id", productId);

    expect(products).toEqual([]);
    expect(sources).toEqual([]);
    expect(selections).toEqual([]);
  });
});
