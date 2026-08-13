import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterEach, expect, it } from "vitest";

import { createTestClient, describeWithDb } from "@/test/setup";
import type {
  CuratedProductImageUsage,
  CuratedProductRow,
  CuratedSelectionRow,
  CuratedSourceRow,
} from "../normalize";
import {
  curatedImageStorageKey,
  syncCuratedProducts,
  type CuratedSyncContent,
} from "../run";

/**
 * The apply half of the curated-product sync (DEV-1404). The planner has its
 * own pure unit test; what can only be proven against a real database and a
 * real bucket is here:
 *
 *   * the three tables land in dependency order, with children keyed by a UUID
 *     that did not exist when the plan was made;
 *   * a second apply of the same fixture is a genuine no-op — no row touched,
 *     no object created. That is the property a partial run depends on, and it
 *     is the one a deterministic storage key exists to make possible;
 *   * `image_usage` gates the upload.
 *
 * Nothing here mocks Supabase (scripts/check-test-boundaries.mjs forbids it).
 * The only seam is `downloadImage`, so the suite makes no outbound request —
 * the bytes are generated locally and still go through the real processImage
 * and the real bucket.
 */

const BUCKET = "brand-images";
const REMOTE_IMAGE_URL = "https://cdn.example.org/curated/alpine-shell.jpg";
const REMOTE_SOURCE_URL = "https://example.org/products/alpine-shell";

type Fixture = {
  brandId: string;
  brandSlug: string;
  content: CuratedSyncContent;
};

function buildContent(
  brandSlug: string,
  imageUsage: CuratedProductImageUsage = "permitted",
): CuratedSyncContent {
  const products: CuratedProductRow[] = [
    {
      brandSlug,
      key: "alpine-shell",
      nameZh: "高山風衣",
      nameEn: "Alpine Shell",
      l1: "fashion",
      l2: [],
      officialUrl: "https://example.org/products/alpine-shell",
      imageUrl: REMOTE_IMAGE_URL,
      imageSourceUrl: REMOTE_SOURCE_URL,
      imageUsage,
      lifecycle: "published",
      sourceCheckedAt: "2026-08-01T00:00:00.000Z",
      reviewDueAt: "2026-11-01T00:00:00.000Z",
      notesZh: "台灣製防水透氣布料",
      notesEn: null,
    },
  ];

  const sources: CuratedSourceRow[] = [
    {
      brandSlug,
      productKey: "alpine-shell",
      url: "https://example.org/products/alpine-shell",
      sourceType: "official",
      claimZh: "台灣製造",
      claimEn: null,
      checkedAt: "2026-08-01T00:00:00.000Z",
    },
    {
      brandSlug,
      productKey: "alpine-shell",
      url: "https://press.example.org/alpine-shell",
      sourceType: "press",
      claimZh: null,
      claimEn: null,
      checkedAt: null,
    },
  ];

  const selections: CuratedSelectionRow[] = [
    {
      brandSlug,
      productKey: "alpine-shell",
      trailSlug: "taiwan-outdoor",
      sectionKey: "shells",
      position: 1,
      rationaleZh: "台灣山林氣候下的第一件外層",
      rationaleEn: null,
    },
  ];

  return { products, sources, selections };
}

describeWithDb("curated product apply", () => {
  const supabase = (
    process.env.RUN_SUPABASE_INTEGRATION_TESTS === "true"
      ? createTestClient()
      : null
  )!;
  const brandIds: string[] = [];

  afterEach(async () => {
    for (const brandId of brandIds) {
      // Objects first: once the brand row goes, the product ids that name the
      // storage prefixes are gone with it and the objects are unreachable.
      const keys = await listStoredObjects(brandId);
      if (keys.length > 0) {
        await supabase.storage.from(BUCKET).remove(keys);
      }
    }
    if (brandIds.length > 0) {
      // Products, sources, and selections all cascade from the brand row.
      await supabase.from("brands").delete().in("id", brandIds);
      brandIds.length = 0;
    }
  });

  /** Every object under `curated-products/<brand-id>/`, one level down. */
  async function listStoredObjects(brandId: string): Promise<string[]> {
    const prefix = `curated-products/${brandId}`;
    const { data: folders, error } = await supabase.storage
      .from(BUCKET)
      .list(prefix, { limit: 100 });
    if (error) throw error;

    const keys: string[] = [];
    for (const folder of folders ?? []) {
      const { data: objects, error: listError } = await supabase.storage
        .from(BUCKET)
        .list(`${prefix}/${folder.name}`, { limit: 100 });
      if (listError) throw listError;
      for (const object of objects ?? []) {
        keys.push(`${prefix}/${folder.name}/${object.name}`);
      }
    }
    return keys.sort();
  }

  async function seedBrand(): Promise<Fixture> {
    const brandId = randomUUID();
    brandIds.push(brandId);
    const suffix = brandId.slice(0, 8);
    const brandSlug = `curated-apply-fixture-${suffix}`;

    const { error } = await supabase.from("brands").insert({
      id: brandId,
      name: `Curated Apply Fixture ${suffix}`,
      slug: brandSlug,
      status: "approved",
    });
    expect(error).toBeNull();

    return { brandId, brandSlug, content: buildContent(brandSlug) };
  }

  /** A real 8x8 PNG, so processImage does real work on real bytes. */
  async function fakeImageBytes(): Promise<Buffer> {
    return sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 180, g: 90, b: 40 },
      },
    })
      .png()
      .toBuffer();
  }

  function downloader(): {
    download: (url: string) => Promise<Buffer>;
    urls: string[];
  } {
    const urls: string[] = [];
    return {
      urls,
      download: async (url: string) => {
        urls.push(url);
        return fakeImageBytes();
      },
    };
  }

  it("applies products, sources and selections in one run", async () => {
    const fixture = await seedBrand();
    const { download, urls } = downloader();

    const result = await syncCuratedProducts({
      content: fixture.content,
      brandIdBySlug: { [fixture.brandSlug]: fixture.brandId },
      apply: true,
      client: supabase,
      downloadImage: download,
    });

    expect(result.unmatchedBrandSlugs).toEqual([]);
    expect(result.totals.productInserts).toBe(1);
    expect(result.totals.sourceUpserts).toBe(2);
    expect(result.totals.selectionUpserts).toBe(1);
    expect(result.affectedBrandSlugs).toEqual([fixture.brandSlug]);

    const { data: products } = await supabase
      .from("curated_products")
      .select("id, key, name_zh, lifecycle, image_usage, image_url")
      .eq("brand_id", fixture.brandId);
    expect(products).toHaveLength(1);
    const product = products![0]!;
    expect(product.key).toBe("alpine-shell");
    expect(product.lifecycle).toBe("published");

    const { data: sources } = await supabase
      .from("curated_product_sources")
      .select("url, source_type, state")
      .eq("product_id", product.id)
      .order("url");
    expect(sources?.map((row) => row.source_type)).toEqual([
      "official",
      "press",
    ]);
    expect(sources?.every((row) => row.state === "active")).toBe(true);

    const { data: selections } = await supabase
      .from("curated_product_selections")
      .select("trail_slug, section_key, position, state")
      .eq("product_id", product.id);
    expect(selections).toHaveLength(1);
    expect(selections![0]!.trail_slug).toBe("taiwan-outdoor");
    expect(selections![0]!.section_key).toBe("shells");

    // The image was fetched from the authored URL and the row now points at the
    // mirror, which is the only reference the storage sweep can resolve.
    expect(urls).toEqual([REMOTE_IMAGE_URL]);
    const storageKey = curatedImageStorageKey(
      fixture.brandId,
      product.id,
      REMOTE_SOURCE_URL,
    );
    expect(await listStoredObjects(fixture.brandId)).toEqual([storageKey]);
    expect(product.image_url).toContain(storageKey);
  });

  it("a second apply against the same fixture writes nothing and uploads nothing", async () => {
    const fixture = await seedBrand();
    const first = downloader();
    await syncCuratedProducts({
      content: fixture.content,
      brandIdBySlug: { [fixture.brandSlug]: fixture.brandId },
      apply: true,
      client: supabase,
      downloadImage: first.download,
    });

    const before = await snapshot(fixture.brandId);
    const objectsBefore = await listStoredObjects(fixture.brandId);
    expect(objectsBefore).toHaveLength(1);

    const second = downloader();
    const result = await syncCuratedProducts({
      content: fixture.content,
      brandIdBySlug: { [fixture.brandSlug]: fixture.brandId },
      apply: true,
      client: supabase,
      downloadImage: second.download,
    });

    expect(result.operations).toBe(0);
    expect(result.images.map((image) => image.action)).toEqual(["reused"]);
    expect(second.urls).toEqual([]);

    // Zero row changes: `updated_at` is trigger-maintained, so any write at all
    // — including a no-op upsert — would move it.
    expect(await snapshot(fixture.brandId)).toEqual(before);
    // Zero new storage objects.
    expect(await listStoredObjects(fixture.brandId)).toEqual(objectsBefore);
  });

  it("re-applying a product with an unchanged image_source_url reuses the same object path", async () => {
    const fixture = await seedBrand();
    const first = downloader();
    const firstResult = await syncCuratedProducts({
      content: fixture.content,
      brandIdBySlug: { [fixture.brandSlug]: fixture.brandId },
      apply: true,
      client: supabase,
      downloadImage: first.download,
    });

    const second = downloader();
    const secondResult = await syncCuratedProducts({
      content: fixture.content,
      brandIdBySlug: { [fixture.brandSlug]: fixture.brandId },
      apply: true,
      client: supabase,
      downloadImage: second.download,
    });

    const firstKey = firstResult.images[0]?.storageKey ?? null;
    expect(firstKey).toBeTruthy();
    expect(secondResult.images[0]?.storageKey).toBe(firstKey);
    // One object, not two: a random path would have left the first orphaned.
    expect(await listStoredObjects(fixture.brandId)).toEqual([firstKey]);
  });

  it("a product with image_usage other than permitted uploads no object", async () => {
    const fixture = await seedBrand();
    const { download, urls } = downloader();

    const result = await syncCuratedProducts({
      content: buildContent(fixture.brandSlug, "licensed"),
      brandIdBySlug: { [fixture.brandSlug]: fixture.brandId },
      apply: true,
      client: supabase,
      downloadImage: download,
    });

    expect(result.images.map((image) => image.action)).toEqual(["skipped"]);
    expect(result.images[0]?.reason).toContain("licensed");
    expect(urls).toEqual([]);
    expect(await listStoredObjects(fixture.brandId)).toEqual([]);

    // The authored URL is left exactly as authored: nothing was mirrored, so
    // rewriting it would point the page at an object that does not exist.
    const { data: products } = await supabase
      .from("curated_products")
      .select("image_url, image_usage")
      .eq("brand_id", fixture.brandId);
    expect(products![0]!.image_url).toBe(REMOTE_IMAGE_URL);
    expect(products![0]!.image_usage).toBe("licensed");
  });

  /** Every row of the three tables, with the timestamps that prove a write. */
  async function snapshot(brandId: string) {
    const { data: products } = await supabase
      .from("curated_products")
      .select("id, key, image_url, lifecycle, updated_at")
      .eq("brand_id", brandId)
      .order("key");
    const productIds = (products ?? []).map((row) => row.id);

    const { data: sources } = await supabase
      .from("curated_product_sources")
      .select("product_id, url, state, updated_at")
      .in("product_id", productIds)
      .order("url");
    const { data: selections } = await supabase
      .from("curated_product_selections")
      .select("product_id, trail_slug, section_key, state, updated_at")
      .in("product_id", productIds)
      .order("trail_slug");

    return { products, sources, selections };
  }
});
