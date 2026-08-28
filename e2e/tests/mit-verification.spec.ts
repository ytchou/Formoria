import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { BUDGET, POLL } from "../budgets";
import { expect, test } from "../fixtures/auth";

const TRAIL_SLUG = "small-space-reading-corner";
const TRAIL_SECTION = "light-first";
const BADGE_LABEL = "台灣製造";
// Keep the fixture within the homepage grid's 8-product cap so the qualified
// product is always present regardless of the day's deterministic shuffle.
const BRAND_COUNT = 4;
const PRODUCTS_PER_BRAND = 2;

type SeededBrand = { id: string; slug: string; name: string };
type SeededProduct = { id: string; key: string; brand_id: string };

test.describe.serial("Product-level Made in Taiwan badge", () => {
  let supabase: SupabaseClient | undefined;
  let brands: SeededBrand[] = [];
  let qualifiedName = "";
  let siblingName = "";

  test.beforeAll(async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "Product-origin E2E requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
      );
    }

    supabase = createClient(url, key);
    const suffix = `${Date.now()}`;
    qualifiedName = `Origin Qualified ${suffix}`;
    siblingName = `Origin Sibling ${suffix}`;

    const { data: brandRows, error: brandError } = await supabase
      .from("brands")
      .insert(
        Array.from({ length: BRAND_COUNT }, (_unused, index) => ({
          name: `[E2E-COMMUNITY] Product Origin ${suffix} ${index + 1}`,
          slug: `e2e-product-origin-${suffix}-${index + 1}`,
          status: "approved",
          approved_at: new Date().toISOString(),
          category: "home",
          description: "Temporary product-origin badge journey fixture.",
          is_demo: false,
        })),
      )
      .select("id, slug, name");
    if (brandError || !brandRows || brandRows.length !== BRAND_COUNT) {
      throw new Error(
        `Product-origin brand seed failed: ${brandError?.message ?? "incomplete result"}`,
      );
    }
    brands = brandRows as SeededBrand[];

    const now = new Date().toISOString();
    const productRows = brands.flatMap((brand, brandIndex) =>
      Array.from({ length: PRODUCTS_PER_BRAND }, (_unused, productIndex) => {
        const isTarget = brandIndex === 0 && productIndex === 0;
        const isSibling = brandIndex === 0 && productIndex === 1;
        const ordinal = brandIndex * PRODUCTS_PER_BRAND + productIndex + 1;
        const name = isTarget
          ? qualifiedName
          : isSibling
            ? siblingName
            : `Origin Product ${suffix} ${ordinal}`;

        return {
          brand_id: brand.id,
          key: `origin-product-${suffix}-${ordinal}`,
          name_zh: name,
          name_en: name,
          category: "home",
          subcategories: ["lighting"],
          official_url: `https://example.com/products/${suffix}-${ordinal}`,
          image_url: "/images/trails/small-space-reading-corner.webp",
          image_source_url: `https://example.com/products/${suffix}-${ordinal}`,
          visible: true,
          link_state: "ok",
          source_checked_at: now,
          product_description_zh: "台灣品牌的閱讀角落用品。",
          product_description_en:
            "A reading-corner object from a Taiwan brand.",
          product_position: productIndex,
          made_in_taiwan_confirmed: !isSibling,
          materials_from_taiwan_confirmed: !isSibling,
        };
      }),
    );

    const { data: products, error: productError } = await supabase
      .from("curated_products")
      .insert(productRows)
      .select("id, key, brand_id");
    if (productError || !products || products.length !== productRows.length) {
      throw new Error(
        `Product-origin product seed failed: ${productError?.message ?? "incomplete result"}`,
      );
    }

    const seededProducts = products as SeededProduct[];
    const { error: sourceError } = await supabase
      .from("curated_product_sources")
      .insert(
        seededProducts.map((product) => ({
          product_id: product.id,
          url: `https://example.com/source/${product.key}`,
          source_type: "official",
          checked_at: now,
          state: "active",
        })),
      );
    if (sourceError) {
      throw new Error(
        `Product-origin source seed failed: ${sourceError.message}`,
      );
    }

    const target = seededProducts.find(
      (product) => product.key === `origin-product-${suffix}-1`,
    );
    if (!target) throw new Error("Product-origin target product is missing");

    const { error: selectionError } = await supabase
      .from("curated_product_selections")
      .insert({
        product_id: target.id,
        trail_slug: TRAIL_SLUG,
        section_key: TRAIL_SECTION,
        position: 0,
        state: "active",
      });
    if (selectionError) {
      throw new Error(
        `Product-origin trail seed failed: ${selectionError.message}`,
      );
    }
  });

  test.afterAll(async () => {
    if (!supabase || brands.length === 0) return;
    const { error } = await supabase
      .from("brands")
      .delete()
      .in(
        "id",
        brands.map((brand) => brand.id),
      );
    if (error) {
      throw new Error(`Product-origin cleanup failed: ${error.message}`);
    }
  });

  test("qualified product is badged across product surfaces without brand inheritance", async ({
    anonPage,
  }) => {
    test.setTimeout(BUDGET.TEST.JOURNEY);
    const targetBrand = brands[0];
    if (!targetBrand) throw new Error("Product-origin target brand is missing");

    const brandResponse = await anonPage.goto(`/brands/${targetBrand.slug}`);
    test.skip(brandResponse?.status() === 503, "PREVIEW_MODE active");

    const brandHeading = anonPage.getByRole("heading", {
      level: 1,
      name: targetBrand.name,
    });
    await expect(brandHeading).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
    await expect(
      brandHeading.locator("..").getByLabel(BADGE_LABEL),
    ).toHaveCount(0);

    const qualifiedTile = anonPage.getByRole("listitem").filter({
      has: anonPage.getByRole("heading", {
        level: 3,
        name: qualifiedName,
      }),
    });
    const siblingTile = anonPage.getByRole("listitem").filter({
      has: anonPage.getByRole("heading", { level: 3, name: siblingName }),
    });
    await expect(qualifiedTile.getByLabel(BADGE_LABEL)).toBeVisible({
      timeout: BUDGET.SERVER_RENDER,
    });
    await expect(siblingTile.getByLabel(BADGE_LABEL)).toHaveCount(0);

    await anonPage.goto(`/style/${TRAIL_SLUG}`);
    const trailTile = anonPage.getByRole("listitem").filter({
      has: anonPage.getByRole("heading", {
        level: 3,
        name: qualifiedName,
      }),
    });
    await expect(trailTile.getByLabel(BADGE_LABEL)).toBeVisible({
      timeout: BUDGET.SERVER_RENDER,
    });

    await expect(async () => {
      await anonPage.goto(`/?origin-fixture=${Date.now()}`);
      const seededWallTile = anonPage
        .getByRole("listitem")
        .filter({ has: anonPage.getByText(/^Origin (?:Qualified|Product)/) })
        .filter({ has: anonPage.getByLabel(BADGE_LABEL) })
        .first();
      await expect(seededWallTile).toBeVisible();
    }).toPass(POLL.DB);

    await anonPage.goto(
      `/brands?search=${encodeURIComponent(targetBrand.name)}`,
    );
    const brandCard = anonPage
      .getByRole("article")
      .filter({ has: anonPage.getByRole("link", { name: targetBrand.name }) });
    await expect(brandCard).toBeVisible({ timeout: BUDGET.SERVER_RENDER });
    await expect(brandCard.getByLabel(BADGE_LABEL)).toHaveCount(0);
    await expect(brandCard).not.toContainText(/MIT/);
  });
});
