import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { createTestClient, describeWithDb } from "@/test/setup";
import {
  createCuratedProduct,
  getPublishedCuratedProductsForBrand,
  promoteCuratedProduct,
  retireCuratedProduct,
  retireCuratedProductSource,
} from "../curated-products";

type SeedProduct = {
  key: string;
  lifecycle?: string;
  officialUrl?: string | null;
  sourceCheckedAt?: string | null;
  createdAt?: string;
  highlightPosition?: number | null;
  highlightRationaleZh?: string | null;
  highlightRationaleEn?: string | null;
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
      approved_at: "2026-01-02T00:00:00Z",
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
          created_at: product.createdAt,
          highlight_position: product.highlightPosition ?? null,
          highlight_rationale_zh: product.highlightRationaleZh ?? null,
          highlight_rationale_en: product.highlightRationaleEn ?? null,
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

  it("returns published products for a brand, ordered by highlight position instead of selection position", async () => {
    const brandId = await seedBrand([
      {
        key: "second-pick",
        selections: [{ trailSlug: "gifting", position: 2 }],
        highlightPosition: 0,
        highlightRationaleZh: "Brand-page first",
      },
      {
        key: "first-pick",
        selections: [{ trailSlug: "gifting", position: 1 }],
        highlightPosition: 1,
        highlightRationaleZh: "Brand-page second",
      },
    ]);

    const products = await getPublishedCuratedProductsForBrand(
      brandId,
      supabase,
    );

    expect(products.map((product) => product.key)).toEqual([
      "second-pick",
      "first-pick",
    ]);
    const first = products.at(0);
    expect(first?.nameZh).toBe("Fixture second-pick");
    expect(first?.l1).toBe("home");
    expect(first?.l2).toEqual(["tableware"]);
    expect(first?.trailSlug).toBe("gifting");
    expect(first?.sectionKey).toBe("picks");
    expect(first?.position).toBe(2);
    expect(first?.rationaleZh).toBe("Brand-page first");
    expect(first?.officialUrl).toContain("second-pick");
    expect(first?.linkState).toBe("ok");
  });

  it("orders the unhighlighted tail by created_at then key, not trail position", async () => {
    const brandId = await seedBrand([
      {
        key: "newer-pick",
        createdAt: "2026-08-15T00:00:00Z",
        selections: [{ trailSlug: "gifting", position: 0 }],
      },
      {
        key: "older-pick",
        createdAt: "2026-08-14T00:00:00Z",
        selections: [{ trailSlug: "gifting", position: 99 }],
      },
    ]);

    const products = await getPublishedCuratedProductsForBrand(
      brandId,
      supabase,
    );

    expect(products.map((product) => product.key)).toEqual([
      "older-pick",
      "newer-pick",
    ]);
  });

  it("resolves highlight rationale before the winning trail rationale", async () => {
    const brandId = await seedBrand([
      {
        key: "highlighted-pick",
        highlightPosition: 0,
        highlightRationaleZh: "Brand-page reason",
        highlightRationaleEn: "Brand-page reason EN",
        selections: [
          {
            trailSlug: "gifting",
            position: 1,
            rationaleZh: "Trail reason",
          },
        ],
      },
    ]);

    const [product] = await getPublishedCuratedProductsForBrand(
      brandId,
      supabase,
    );

    expect(product?.rationaleZh).toBe("Brand-page reason");
    expect(product?.rationaleEn).toBe("Brand-page reason EN");
  });

  it("keeps a highlight rationale when its position is null", async () => {
    const brandId = await seedBrand([
      {
        key: "unplaced-with-reason",
        highlightPosition: null,
        highlightRationaleZh: "Unordered brand reason",
      },
    ]);

    const [product] = await getPublishedCuratedProductsForBrand(
      brandId,
      supabase,
    );

    expect(product?.highlightPosition).toBeNull();
    expect(product?.rationaleZh).toBe("Unordered brand reason");
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
        highlightPosition: 1,
        highlightRationaleZh: "Brand-page pick",
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

  it("rejects a highlight position with no zh rationale", async () => {
    const brandId = await seedBrand([]);
    const { error } = await supabase.from("curated_products").insert({
      brand_id: brandId,
      key: "invalid-highlight",
      name_zh: "Invalid Highlight",
      l1: "home",
      official_url: "https://example.com/invalid-highlight",
      lifecycle: "published",
      source_checked_at: new Date().toISOString(),
      highlight_position: 0,
      highlight_rationale_zh: null,
    });

    expect(error?.code).toBe("23514");
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

/**
 * The editorial write path (DEV-1465). Promotion is the only gate that turns an
 * internal candidate into a public factual claim, so its four conditions are
 * asserted against a real database rather than a stub: three of them are also
 * enforced by the read query, and a divergence between the two would publish a
 * row the brand page then silently drops.
 */
describeWithDb("curated product write path", () => {
  const supabase = (
    process.env.RUN_SUPABASE_INTEGRATION_TESTS === "true"
      ? createTestClient()
      : null
  )!;
  const brandIds: string[] = [];

  afterEach(async () => {
    if (brandIds.length > 0) {
      await supabase.from("brands").delete().in("id", brandIds);
      brandIds.length = 0;
    }
  });

  async function seedBrand(): Promise<string> {
    const brandId = randomUUID();
    brandIds.push(brandId);
    const suffix = brandId.slice(0, 8);

    const { error } = await supabase.from("brands").insert({
      id: brandId,
      name: `Curated Write Fixture ${suffix}`,
      slug: `curated-write-fixture-${suffix}`,
      status: "approved",
      approved_at: "2026-01-02T00:00:00Z",
    });
    expect(error).toBeNull();
    return brandId;
  }

  async function addSource(
    productId: string,
    state: "active" | "retired" = "active",
  ): Promise<string> {
    const sourceId = randomUUID();
    const { error } = await supabase.from("curated_product_sources").insert({
      id: sourceId,
      product_id: productId,
      url: `https://example.com/${sourceId}/evidence`,
      source_type: "official",
      claim_zh: "Evidence",
      state,
    });
    expect(error).toBeNull();
    return sourceId;
  }

  async function lifecycleOf(productId: string): Promise<string> {
    const { data, error } = await supabase
      .from("curated_products")
      .select("lifecycle")
      .eq("id", productId)
      .single();
    expect(error).toBeNull();
    return data?.lifecycle as string;
  }

  /** Narrows a promote outcome to its refusal, failing the test when it succeeded. */
  function expectRefusal(
    result: Awaited<ReturnType<typeof promoteCuratedProduct>>,
  ) {
    if (result.ok) throw new Error("Expected the promote to be refused");
    return result;
  }

  /** Everything a promote needs except whatever the caller withholds. */
  async function seedCandidate(
    overrides: {
      officialUrl?: string | null;
      sourceCheckedAt?: string | null;
    } = {},
  ): Promise<{ brandId: string; productId: string }> {
    const brandId = await seedBrand();
    const created = await createCuratedProduct(
      {
        brandId,
        nameZh: "Ceramic Teacup",
        nameEn: "Ceramic Teacup",
        l1: "home",
        l2: ["tableware"],
        officialUrl:
          overrides.officialUrl === undefined
            ? `https://example.com/${brandId.slice(0, 8)}/teacup`
            : overrides.officialUrl,
        sourceCheckedAt:
          overrides.sourceCheckedAt === undefined
            ? new Date().toISOString()
            : overrides.sourceCheckedAt,
      },
      supabase,
    );
    return { brandId, productId: created.id };
  }

  it("create_writes_candidate_lifecycle — a created row lands as candidate/admin", async () => {
    const { productId } = await seedCandidate();

    const { data } = await supabase
      .from("curated_products")
      .select("lifecycle, proposed_by, key")
      .eq("id", productId)
      .single();

    expect(data?.lifecycle).toBe("candidate");
    expect(data?.proposed_by).toBe("admin");
    expect(data?.key).toBe("ceramic-teacup");
  });

  it("create_suffixes_key_on_collision — the unique (brand_id, key) is resolved, not thrown", async () => {
    const brandId = await seedBrand();
    const input = {
      brandId,
      nameZh: "Ceramic Teacup",
      l1: "home",
    };

    const first = await createCuratedProduct(input, supabase);
    const second = await createCuratedProduct(input, supabase);

    expect(first.key).toBe("ceramic-teacup");
    expect(second.key).toBe("ceramic-teacup-2");
  });

  it("promote_refuses_when_official_url_null", async () => {
    const { productId } = await seedCandidate({ officialUrl: null });
    await addSource(productId);

    const result = await promoteCuratedProduct(productId, supabase);

    const refusal = expectRefusal(result);
    expect(refusal.blockers).toContain("official_url");
    expect(refusal.error).toContain("official_url");
    expect(await lifecycleOf(productId)).toBe("candidate");
  });

  it("promote_refuses_when_source_checked_at_null", async () => {
    const { productId } = await seedCandidate({ sourceCheckedAt: null });
    await addSource(productId);

    const result = await promoteCuratedProduct(productId, supabase);

    expect(expectRefusal(result).blockers).toContain("source_checked_at");
    expect(await lifecycleOf(productId)).toBe("candidate");
  });

  it("promote_refuses_when_no_active_source", async () => {
    // The row exists; it is retired. Row presence is not evidence.
    const { productId } = await seedCandidate();
    await addSource(productId, "retired");

    const result = await promoteCuratedProduct(productId, supabase);

    expect(expectRefusal(result).blockers).toContain("no_active_source");
    expect(await lifecycleOf(productId)).toBe("candidate");
  });

  it("promote_refuses_when_already_retired", async () => {
    const { productId } = await seedCandidate();
    await addSource(productId);
    await retireCuratedProduct(productId, supabase);

    const result = await promoteCuratedProduct(productId, supabase);

    expect(expectRefusal(result).blockers).toContain("lifecycle");
    expect(await lifecycleOf(productId)).toBe("retired");
  });

  it("promote_succeeds_when_all_four_hold", async () => {
    const { brandId, productId } = await seedCandidate();
    await addSource(productId);

    const result = await promoteCuratedProduct(productId, supabase);

    expect(result.ok).toBe(true);
    expect(await lifecycleOf(productId)).toBe("published");

    // The write gate and the read gate must agree: a promoted product has to be
    // one the public brand page actually renders.
    const products = await getPublishedCuratedProductsForBrand(
      brandId,
      supabase,
    );
    expect(products.map((product) => product.id)).toEqual([productId]);
  });

  it("retire_sets_retired_and_keeps_sources", async () => {
    const { productId } = await seedCandidate();
    const sourceId = await addSource(productId);

    await retireCuratedProduct(productId, supabase);

    expect(await lifecycleOf(productId)).toBe("retired");
    const { data: sources } = await supabase
      .from("curated_product_sources")
      .select("id, state")
      .eq("product_id", productId);
    expect(sources).toEqual([{ id: sourceId, state: "active" }]);
  });

  it("retire_source_flips_state_not_delete", async () => {
    const { productId } = await seedCandidate();
    const sourceId = await addSource(productId);

    await retireCuratedProductSource(sourceId, supabase);

    const { data: sources } = await supabase
      .from("curated_product_sources")
      .select("id, state")
      .eq("product_id", productId);
    expect(sources).toEqual([{ id: sourceId, state: "retired" }]);
  });
});
