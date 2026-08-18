import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { describeWithDb } from "@/test/setup";

const supabase =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
      )
    : null;

type BrandValues = Partial<
  Omit<
    Database["public"]["Tables"]["brands"]["Insert"],
    "id" | "name" | "slug" | "status" | "is_demo"
  >
>;
type SubmissionValues = Partial<
  Omit<
    Database["public"]["Tables"]["brand_submissions"]["Insert"],
    "id" | "brand_name" | "submitter_email" | "intent" | "status"
  >
>;

describeWithDb("DEV-1503 expand vocabulary compatibility", () => {
  const brandIds: string[] = [];
  const submissionIds: string[] = [];

  afterEach(async () => {
    if (submissionIds.length > 0) {
      const { error } = await supabase!
        .from("brand_submissions")
        .delete()
        .in("id", submissionIds);
      expect(error).toBeNull();
      submissionIds.length = 0;
    }
    if (brandIds.length > 0) {
      const { error } = await supabase!
        .from("brands")
        .delete()
        .in("id", brandIds);
      expect(error).toBeNull();
      brandIds.length = 0;
    }
  });

  async function insertBrand(
    label: string,
    values: BrandValues,
  ): Promise<string> {
    const id = randomUUID();
    const { error } = await supabase!.from("brands").insert({
      id,
      name: `DEV-1503 ${label}`,
      slug: `dev-1503-${label}-${id.slice(0, 8)}`,
      status: "approved",
      approved_at: new Date().toISOString(),
      is_demo: true,
      ...values,
    });
    expect(error).toBeNull();
    brandIds.push(id);
    return id;
  }

  async function insertSubmission(
    label: string,
    values: SubmissionValues,
  ): Promise<string> {
    const id = randomUUID();
    const { error } = await supabase!.from("brand_submissions").insert({
      id,
      brand_name: `DEV-1503 ${label}`,
      submitter_email: `dev-1503-${id.slice(0, 8)}@example.com`,
      intent: "recommend",
      status: "pending",
      ...values,
    });
    expect(error).toBeNull();
    submissionIds.push(id);
    return id;
  }

  it("keeps legacy and target physical writes equal and rejects conflicting dual writes", async () => {
    // Bug caught: a mixed Wave 1/Wave 2 revision could write one vocabulary
    // and silently leave the other column stale, or make two values disagree.
    const oldOnlyId = await insertBrand("old-only", {
      product_type: "home",
      product_tags: ["家具"],
      product_tags_en: ["Furniture"],
    });
    const newOnlyId = await insertBrand("new-only", {
      category: "crafts",
      subcategories: ["陶藝"],
      subcategories_en: ["Ceramics"],
    });

    const { data: inserted } = await supabase!
      .from("brands")
      .select(
        "id, product_type, category, product_tags, subcategories, product_tags_en, subcategories_en",
      )
      .in("id", [oldOnlyId, newOnlyId]);
    expect(inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: oldOnlyId,
          product_type: "home",
          category: "home",
          product_tags: ["家具"],
          subcategories: ["家具"],
          product_tags_en: ["Furniture"],
          subcategories_en: ["Furniture"],
        }),
        expect.objectContaining({
          id: newOnlyId,
          product_type: "crafts",
          category: "crafts",
          product_tags: ["陶藝"],
          subcategories: ["陶藝"],
          product_tags_en: ["Ceramics"],
          subcategories_en: ["Ceramics"],
        }),
      ]),
    );

    const { error: legacyUpdateError } = await supabase!
      .from("brands")
      .update({ product_type: "jewelry" })
      .eq("id", oldOnlyId);
    expect(legacyUpdateError).toBeNull();
    const { error: targetUpdateError } = await supabase!
      .from("brands")
      .update({ subcategories: ["戒指"] })
      .eq("id", newOnlyId);
    expect(targetUpdateError).toBeNull();

    const { data: updated } = await supabase!
      .from("brands")
      .select("id, product_type, category, product_tags, subcategories")
      .in("id", [oldOnlyId, newOnlyId]);
    expect(updated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: oldOnlyId,
          product_type: "jewelry",
          category: "jewelry",
        }),
        expect.objectContaining({
          id: newOnlyId,
          product_tags: ["戒指"],
          subcategories: ["戒指"],
        }),
      ]),
    );

    const { error: conflictingError } = await supabase!.from("brands").insert({
      id: randomUUID(),
      name: "DEV-1503 conflicting physical values",
      slug: `dev-1503-conflict-${randomUUID().slice(0, 8)}`,
      status: "approved",
      is_demo: true,
      product_type: "home",
      category: "crafts",
    });
    expect(conflictingError?.message).toMatch(/Conflicting category values/);

    const { error: conflictingUpdateError } = await supabase!
      .from("brands")
      .update({ product_type: "home", category: "crafts" })
      .eq("id", oldOnlyId);
    expect(conflictingUpdateError?.message).toMatch(
      /Conflicting category values/,
    );
  });

  it("synchronizes AI results and submission category notes in both directions", async () => {
    // Bug caught: enrichment or submission-note writes through the new name
    // would otherwise disappear when legacy approval code reads the row.
    const brandId = await insertBrand("ai-target", { category: "beauty" });
    const aiResultId = randomUUID();
    const { error: aiInsertError } = await supabase!
      .from("brand_ai_results")
      .insert({
        id: aiResultId,
        brand_id: brandId,
        phase: "description",
        model: "dev-1503-test",
        category: "beauty",
        subcategories: ["保養"],
      });
    expect(aiInsertError).toBeNull();
    const legacyAiResultId = randomUUID();
    const { error: legacyAiInsertError } = await supabase!
      .from("brand_ai_results")
      .insert({
        id: legacyAiResultId,
        brand_id: brandId,
        phase: "description",
        model: "dev-1503-test",
        product_type: "crafts",
        product_tags: ["木工"],
      });
    expect(legacyAiInsertError).toBeNull();

    const submissionId = await insertSubmission("note", {
      category_note: "生活風格用品",
    });

    const { data: aiResult } = await supabase!
      .from("brand_ai_results")
      .select("product_type, category, product_tags, subcategories")
      .eq("id", aiResultId)
      .single();
    expect(aiResult).toEqual({
      product_type: "beauty",
      category: "beauty",
      product_tags: ["保養"],
      subcategories: ["保養"],
    });
    const { data: legacyAiResult } = await supabase!
      .from("brand_ai_results")
      .select("product_type, category, product_tags, subcategories")
      .eq("id", legacyAiResultId)
      .single();
    expect(legacyAiResult).toEqual({
      product_type: "crafts",
      category: "crafts",
      product_tags: ["木工"],
      subcategories: ["木工"],
    });

    const { error: noteUpdateError } = await supabase!
      .from("brand_submissions")
      .update({ product_type_note: "手作生活用品" })
      .eq("id", submissionId);
    expect(noteUpdateError).toBeNull();
    const { data: submission } = await supabase!
      .from("brand_submissions")
      .select("product_type_note, category_note")
      .eq("id", submissionId)
      .single();
    expect(submission).toEqual({
      product_type_note: "手作生活用品",
      category_note: "手作生活用品",
    });
  });

  it("preserves equality for the seeded legacy rows after the expand backfill", async () => {
    // Bug caught: a partial backfill would leave a mixed physical schema even
    // though both columns exist, breaking the first new application rollout.
    const { data, error } = await supabase!
      .from("brands")
      .select(
        "product_type, category, product_tags, subcategories, product_tags_en, subcategories_en",
      )
      .not("product_type", "is", null)
      .limit(100);
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThan(0);
    for (const row of data ?? []) {
      expect(row.category).toBe(row.product_type);
      expect(row.subcategories).toEqual(row.product_tags);
      expect(row.subcategories_en).toEqual(row.product_tags_en);
    }
  });

  it("writes both snake_case and form-shaped aliases in every pending JSON container", async () => {
    // Bug caught: pending review data written by one revision would lose its
    // category/subcategory values when the other revision reads another JSON
    // container, including refresh clearing sentinels.
    const submissionId = await insertSubmission("json-aliases", {
      enriched_data: {
        product_type: "home",
        product_tags: ["家具"],
        product_tags_en: ["Furniture"],
        _cleared_fields: ["product_type", "product_tags"],
      },
      review_overrides: {
        category: "crafts",
        subcategories: ["陶藝"],
        subcategories_en: ["Ceramics"],
      },
      base_brand_data: {
        productType: "beauty",
        productTags: ["保養"],
        productTagsEn: ["Skincare"],
      },
      owner_data: {
        categorySlug: "jewelry",
        subcategories: ["戒指"],
        subcategoriesEn: ["Rings"],
      },
      suggested_tags: {
        values: ["洋裝"],
        productType: "fashion",
      },
    });

    const { data, error } = await supabase!
      .from("brand_submissions")
      .select(
        "enriched_data, review_overrides, base_brand_data, owner_data, suggested_tags",
      )
      .eq("id", submissionId)
      .single();
    expect(error).toBeNull();

    const containers = [
      data?.enriched_data,
      data?.review_overrides,
      data?.base_brand_data,
      data?.owner_data,
      data?.suggested_tags,
    ];
    expect(containers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          product_type: "home",
          category: "home",
          productType: "home",
          categorySlug: "home",
          product_tags: ["家具"],
          subcategories: ["家具"],
          productTags: ["家具"],
          product_tags_en: ["Furniture"],
          subcategories_en: ["Furniture"],
          productTagsEn: ["Furniture"],
          subcategoriesEn: ["Furniture"],
          _cleared_fields: expect.arrayContaining([
            "product_type",
            "category",
            "productType",
            "categorySlug",
            "product_tags",
            "subcategories",
            "productTags",
          ]),
        }),
        expect.objectContaining({
          values: ["洋裝"],
          product_tags: ["洋裝"],
          subcategories: ["洋裝"],
          productTags: ["洋裝"],
          productType: "fashion",
          category: "fashion",
          categorySlug: "fashion",
        }),
      ]),
    );

    for (const container of containers) {
      expect(container).toBeTruthy();
      const object = container as Record<string, Json | undefined>;
      if (object.category !== undefined) {
        expect(object.category).toBe(object.product_type);
        expect(object.categorySlug).toBe(object.product_type);
      }
      if (object.subcategories !== undefined) {
        expect(object.subcategories).toEqual(object.product_tags);
        expect(object.subcategories).toEqual(object.productTags);
      }
    }
  });

  it("rejects conflicting aliases inside pending JSON", async () => {
    // Bug caught: dual JSON keys with different values would make approval
    // depend on which alias a mixed-version function happened to read.
    const { error } = await supabase!.from("brand_submissions").insert({
      id: randomUUID(),
      brand_name: "DEV-1503 conflicting JSON values",
      submitter_email: `dev-1503-conflicting-json-${randomUUID().slice(0, 8)}@example.com`,
      intent: "recommend",
      status: "pending",
      enriched_data: {
        product_type: "home",
        category: "crafts",
      },
    });
    expect(error?.message).toMatch(/Conflicting submission JSON aliases/);
  });
});
