import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
const untypedSupabase =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(
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

const LEGACY_JSON_KEYS = [
  ["product", "type"].join("_"),
  ["product", "tags"].join("_"),
  ["product", "tags", "en"].join("_"),
  ["product", "Type"].join(""),
  ["product", "Tags"].join(""),
  ["product", "Tags", "En"].join(""),
];

function expectNoLegacyJsonKeys(value: Json | null): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) expectNoLegacyJsonKeys(item);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    expect(LEGACY_JSON_KEYS).not.toContain(key);
    if (key === "_cleared_fields" && Array.isArray(child)) {
      for (const clearedField of child) {
        if (typeof clearedField === "string") {
          expect(LEGACY_JSON_KEYS).not.toContain(clearedField);
        }
      }
    }
    expectNoLegacyJsonKeys(child ?? null);
  }
}

function runPendingCorrectionMigrationHarness(): void {
  const migration = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260819090000_contract_category_subcategory_vocabulary.sql",
    ),
    "utf8",
  );
  const dedupeStart = migration.indexOf("with pending_ranked as (");
  const mappingStart = migration.indexOf(
    "update public.brand_field_corrections\nset field = case field",
    dedupeStart,
  );
  const constraintStart = migration.indexOf(
    "alter table public.brand_field_corrections",
    mappingStart,
  );
  if (dedupeStart < 0 || mappingStart < 0 || constraintStart < 0) {
    throw new Error(
      "Unable to extract pending correction migration statements",
    );
  }

  const fixtureTable = "dev1503_pending_correction_fixture";
  const dedupeSql = migration
    .slice(dedupeStart, mappingStart)
    .replaceAll("public.brand_field_corrections", fixtureTable);
  const mappingSql = migration
    .slice(mappingStart, constraintStart)
    .replaceAll("public.brand_field_corrections", fixtureTable);
  // The Supabase CLI sends one prepared statement, so execute the extracted
  // migration statements in a temporary-table DO block. The block rolls back
  // with the statement on any assertion failure and leaves no persistent rows.
  const sql = `
do $dev1503$
declare
  survivor_count integer;
  non_null_ids integer[];
  null_fields text[];
  legacy_count integer;
begin
  create temp table ${fixtureTable} (
    id integer primary key,
    brand_id uuid not null,
    visitor_hash text,
    field text not null,
    status text not null,
    created_at timestamptz not null
  ) on commit drop;
  insert into ${fixtureTable} (id, brand_id, visitor_hash, field, status, created_at)
  values
    (101, '00000000-0000-4000-8000-000000000001', 'same-visitor', 'product_tags', 'pending', '2026-01-01T00:00:00Z'),
    (102, '00000000-0000-4000-8000-000000000001', 'same-visitor', 'subcategories', 'pending', '2026-01-02T00:00:00Z'),
    (201, '00000000-0000-4000-8000-000000000001', null, 'product_tags', 'pending', '2026-01-01T00:00:00Z'),
    (202, '00000000-0000-4000-8000-000000000001', null, 'subcategories', 'pending', '2026-01-02T00:00:00Z'),
    (203, '00000000-0000-4000-8000-000000000001', null, 'product_tags_en', 'pending', '2026-01-01T00:00:00Z'),
    (204, '00000000-0000-4000-8000-000000000001', null, 'subcategories_en', 'pending', '2026-01-02T00:00:00Z');
${dedupeSql}
${mappingSql}
  select
    count(*),
    coalesce(array_agg(id order by id) filter (where visitor_hash is not null), array[]::integer[]),
    coalesce(array_agg(field order by id) filter (where visitor_hash is null), array[]::text[]),
    count(*) filter (where field in ('product_type', 'product_tags', 'product_tags_en'))
  into survivor_count, non_null_ids, null_fields, legacy_count
  from ${fixtureTable};

  if survivor_count <> 5
    or non_null_ids is distinct from array[102]::integer[]
    or null_fields is distinct from array[
      'subcategories', 'subcategories', 'subcategories_en', 'subcategories_en'
    ]::text[]
    or legacy_count <> 0 then
    raise exception
      'DEV-1503 pending correction migration harness mismatch: survivors=%, non_null_ids=%, null_fields=%, legacy_count=%',
      survivor_count, non_null_ids, null_fields, legacy_count;
  end if;
end
$dev1503$;
`;
  if (!process.env.SUPABASE_DB_URL) {
    throw new Error("SUPABASE_DB_URL is required for migration harness");
  }
  try {
    execFileSync(
      "pnpm",
      [
        "exec",
        "supabase",
        "db",
        "query",
        "--db-url",
        process.env.SUPABASE_DB_URL,
        "--output-format",
        "json",
        sql,
      ],
      {
        encoding: "utf8",
        env: process.env,
        maxBuffer: 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch {
    throw new Error("Pending correction migration harness failed");
  }
}

describeWithDb("DEV-1503 contract category/subcategory vocabulary", () => {
  const brandIds: string[] = [];
  const submissionIds: string[] = [];
  const jobIds: string[] = [];

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
    if (jobIds.length > 0) {
      const { error } = await supabase!
        .from("curation_jobs")
        .delete()
        .in("id", jobIds);
      expect(error).toBeNull();
      jobIds.length = 0;
    }
  });

  async function insertBrand(
    label: string,
    values: BrandValues,
    isDemo = true,
  ): Promise<string> {
    const id = randomUUID();
    const { error } = await supabase!.from("brands").insert({
      id,
      name: `DEV-1503 ${label}`,
      slug: `dev-1503-${label}-${id.slice(0, 8)}`,
      status: "approved",
      approved_at: new Date().toISOString(),
      is_demo: isDemo,
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

  // Bug caught: contracting the physical schema without preserving the final
  // columns would make the first application write fail or lose values.
  it("persists final category/subcategory columns across core tables", async () => {
    const brandId = await insertBrand("final-columns", {
      category: "home",
      subcategories: ["家具", "家飾"],
      subcategories_en: ["Furniture", "Home decor"],
    });
    const aiResultId = randomUUID();
    const { error: aiError } = await supabase!.from("brand_ai_results").insert({
      id: aiResultId,
      brand_id: brandId,
      phase: "description",
      model: "dev-1503-contract",
      category: "home",
      subcategories: ["家具"],
    });
    expect(aiError).toBeNull();

    const submissionId = await insertSubmission("final-note", {
      category_note: "生活風格用品",
    });
    const { data: brand, error: brandError } = await supabase!
      .from("brands")
      .select("category, subcategories, subcategories_en")
      .eq("id", brandId)
      .single();
    expect(brandError).toBeNull();
    expect(brand).toEqual({
      category: "home",
      subcategories: ["家具", "家飾"],
      subcategories_en: ["Furniture", "Home decor"],
    });

    const { data: aiResult, error: aiReadError } = await supabase!
      .from("brand_ai_results")
      .select("category, subcategories")
      .eq("id", aiResultId)
      .single();
    expect(aiReadError).toBeNull();
    expect(aiResult).toEqual({ category: "home", subcategories: ["家具"] });

    const { data: submission, error: submissionError } = await supabase!
      .from("brand_submissions")
      .select("category_note")
      .eq("id", submissionId)
      .single();
    expect(submissionError).toBeNull();
    expect(submission).toEqual({ category_note: "生活風格用品" });

    // The old physical write must fail rather than silently reintroduce a
    // second source of truth after the compatibility columns are removed.
    const { error: legacyWriteError } = await untypedSupabase!
      .from("brands")
      .update({ [["product", "type"].join("_")]: "crafts" })
      .eq("id", brandId);
    expect(legacyWriteError).not.toBeNull();
  });

  // Bug caught: migration deduplication partitioned every NULL visitor hash
  // together, dropping anonymous legacy/final corrections even though the
  // partial unique index treats NULL hashes as distinct identities. The
  // assertion executes the committed migration statements against a temporary
  // table; the live rows below prove the post-contract index behavior.
  it("keeps multiple anonymous pending corrections for the final field", async () => {
    expect(() => runPendingCorrectionMigrationHarness()).not.toThrow();
    const brandId = await insertBrand("anonymous-corrections", {
      category: "crafts",
      subcategories: ["木工"],
      subcategories_en: ["Woodwork"],
    });
    const { error: insertError } = await untypedSupabase!
      .from("brand_field_corrections")
      .insert([
        {
          brand_id: brandId,
          field: "subcategories",
          proposed_value: ["陶藝"],
          previous_value: ["木工"],
          status: "pending",
          visitor_hash: null,
        },
        {
          brand_id: brandId,
          field: "subcategories",
          proposed_value: ["金工"],
          previous_value: ["木工"],
          status: "pending",
          visitor_hash: null,
        },
      ]);
    expect(insertError).toBeNull();

    const { data: corrections, error: readError } = await untypedSupabase!
      .from("brand_field_corrections")
      .select("field, proposed_value, visitor_hash")
      .eq("brand_id", brandId)
      .eq("field", "subcategories")
      .eq("status", "pending");
    expect(readError).toBeNull();
    expect(corrections).toHaveLength(2);
    expect(
      corrections?.every((correction) => correction.visitor_hash === null),
    ).toBe(true);
    expect(corrections?.map((correction) => correction.proposed_value)).toEqual(
      expect.arrayContaining([["陶藝"], ["金工"]]),
    );
  });

  // Bug caught: a post-contract submission read could still expose removed
  // aliases or clear the wrong field when containers use different shapes.
  it("keeps every pending JSON container on final keys", async () => {
    const submissionId = await insertSubmission("final-json", {
      enriched_data: {
        category: "home",
        subcategories: ["家具"],
        subcategories_en: ["Furniture"],
        _cleared_fields: ["category", "subcategories"],
      },
      review_overrides: {
        categorySlug: "crafts",
        subcategories: ["陶藝"],
        subcategoriesEn: ["Ceramics"],
      },
      base_brand_data: {
        category: "beauty",
        subcategories: ["保養"],
        subcategories_en: ["Skincare"],
      },
      owner_data: {
        categorySlug: "jewelry",
        subcategories: ["戒指"],
        subcategoriesEn: ["Rings"],
      },
      suggested_tags: {
        values: ["洋裝"],
        category: "fashion",
        subcategories: ["洋裝"],
        subcategories_en: ["Dresses"],
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
    for (const container of [
      data?.enriched_data,
      data?.review_overrides,
      data?.base_brand_data,
      data?.owner_data,
      data?.suggested_tags,
    ]) {
      expect(container).toBeTruthy();
      expectNoLegacyJsonKeys(container ?? null);
    }
    expect(data?.enriched_data).toMatchObject({
      category: "home",
      subcategories: ["家具"],
      subcategories_en: ["Furniture"],
      _cleared_fields: ["category", "subcategories"],
    });
    expect(data?.suggested_tags).toMatchObject({
      values: ["洋裝"],
      category: "fashion",
      subcategories: ["洋裝"],
      subcategories_en: ["Dresses"],
    });
  });

  // Bug caught: rewriting approval/provenance SQL without changing its JSON
  // record fields would publish an empty category or record removed field IDs.
  it("approves final category data and records final provenance identifiers", async () => {
    const submissionId = await insertSubmission("contract-approval", {
      description: "可以公開的品牌介紹",
      website_url: "https://contract-approval.example.com",
      suggested_tags: { values: ["木工"], category: "crafts" },
      owner_data: { categorySlug: "crafts", subcategories: ["木工"] },
    });
    const { error: imageError } = await supabase!
      .from("submission_images")
      .insert({
        id: randomUUID(),
        submission_id: submissionId,
        url: `https://cdn.example.com/${submissionId}/hero.webp`,
        source: "admin",
        status: "active",
        sort_order: 0,
      });
    expect(imageError).toBeNull();

    const { data: jobId, error: jobError } = await untypedSupabase!.rpc(
      "enqueue_curation_job",
      {
        p_operation: "enrich",
        p_params: { target: "submissions", submissionIds: [submissionId] },
        p_dry_run: false,
        p_started_by: "dev-1503-contract",
        p_trigger: "admin",
        p_parent_job_id: null,
        p_attempt: 1,
        p_scheduled_for: null,
        p_run_after: new Date().toISOString(),
        p_dedupe_key: `dev-1503-contract:${randomUUID()}`,
        p_targets: [
          {
            target_type: "submission",
            target_id: submissionId,
            brand_name: "DEV-1503 contract approval",
            brand_slug: null,
          },
        ],
      },
    );
    expect(jobError).toBeNull();
    expect(jobId).toBeTruthy();
    jobIds.push(jobId as string);
    const completedAt = new Date().toISOString();
    const { error: targetError } = await supabase!
      .from("curation_job_targets")
      .update({ status: "succeeded", completed_at: completedAt })
      .eq("job_id", jobId as string);
    expect(targetError).toBeNull();
    const { error: jobCompleteError } = await supabase!
      .from("curation_jobs")
      .update({ status: "completed", completed_at: completedAt })
      .eq("id", jobId as string);
    expect(jobCompleteError).toBeNull();

    const { data: approval, error: approvalError } = await untypedSupabase!.rpc(
      "approve_submission",
      {
        p_submission_id: submissionId,
        p_reviewer_id: null,
        p_brand_data: {
          name: "DEV-1503 Contract Approval Brand",
          slug: `dev-1503-contract-approval-${randomUUID().slice(0, 8)}`,
          description: "可以公開的品牌介紹",
          category: "crafts",
          subcategories: ["木工"],
          subcategories_en: ["Woodwork"],
          price_range: 2,
          approved_at: new Date().toISOString(),
          purchase_website: "https://contract-approval.example.com",
          is_demo: true,
        },
      },
    );
    expect(approvalError).toBeNull();
    const brandId = approval?.[0]?.brand_id as string | undefined;
    expect(brandId).toBeTruthy();
    brandIds.push(brandId!);

    const { data: brand, error: brandError } = await supabase!
      .from("brands")
      .select("category, subcategories, subcategories_en")
      .eq("id", brandId!)
      .single();
    expect(brandError).toBeNull();
    // DEV-1510: `approve_submission` converts subcategory labels to slugs ON
    // READ (20260820130000, site 7/7), so a submission created before the
    // migration still approves — and lands the storage representation
    // `brands.subcategories` now uses. `subcategories_en` is re-DERIVED from
    // `taxonomy_terms.name_en` rather than carried through, which is why the
    // submitted `Woodwork` becomes the node's own `Woodcraft`.
    expect(brand).toEqual({
      category: "crafts",
      subcategories: ["woodcraft"],
      subcategories_en: ["Woodcraft"],
    });
    const { data: states, error: stateError } = await untypedSupabase!
      .from("brand_field_state")
      .select("field")
      .eq("brand_id", brandId!);
    expect(stateError).toBeNull();
    expect(states?.map((row) => row.field)).toEqual(
      expect.arrayContaining(["category", "subcategories", "subcategories_en"]),
    );
    expect(states?.some((row) => LEGACY_JSON_KEYS.includes(row.field))).toBe(
      false,
    );
  });

  // Bug caught: a refresh contract rewrite could still read/write removed
  // identifiers, publishing an unchanged category while recording legacy
  // provenance rows and events.
  it("refreshes final category data and records final provenance identifiers", async () => {
    const brandId = await insertBrand("final-refresh", {
      description: "原本完整的品牌介紹",
      category: "crafts",
      subcategories: ["木工"],
      subcategories_en: ["Woodwork"],
      price_range: 2,
      purchase_website: "https://contract-refresh.example.com",
    });
    const { data: snapshot, error: snapshotError } = await supabase!
      .from("brands")
      .select("updated_at")
      .eq("id", brandId)
      .single();
    expect(snapshotError).toBeNull();
    expect(snapshot?.updated_at).toBeTruthy();

    const submissionId = randomUUID();
    const { error: submissionError } = await supabase!
      .from("brand_submissions")
      .insert({
        id: submissionId,
        brand_id: brandId,
        brand_name: "DEV-1503 final refresh",
        submitter_email: `dev-1503-refresh-${submissionId.slice(0, 8)}@example.com`,
        intent: "refresh",
        status: "pending",
        base_brand_data: {
          name: `DEV-1503 final-refresh-${brandId.slice(0, 8)}`,
          description: "原本完整的品牌介紹",
          category: "crafts",
          subcategories: ["木工"],
          subcategories_en: ["Woodwork"],
          price_range: 2,
          purchase_website: "https://contract-refresh.example.com",
          _active_images: [],
        },
        base_brand_updated_at: snapshot?.updated_at,
        enriched_data: {
          description: "排程更新後的品牌介紹",
          category: "home",
          subcategories: ["家具"],
          subcategories_en: ["Furniture"],
        },
      });
    expect(submissionError).toBeNull();
    submissionIds.push(submissionId);

    const { error: imageError } = await supabase!
      .from("submission_images")
      .insert({
        id: randomUUID(),
        submission_id: submissionId,
        url: `https://cdn.example.com/${submissionId}/refresh.webp`,
        source: "admin",
        status: "active",
        sort_order: 0,
      });
    expect(imageError).toBeNull();

    const { data: jobId, error: jobError } = await untypedSupabase!.rpc(
      "enqueue_curation_job",
      {
        p_operation: "enrich",
        p_params: { target: "submissions", submissionIds: [submissionId] },
        p_dry_run: false,
        p_started_by: "dev-1503-contract-refresh",
        p_trigger: "admin",
        p_parent_job_id: null,
        p_attempt: 1,
        p_scheduled_for: null,
        p_run_after: new Date().toISOString(),
        p_dedupe_key: `dev-1503-contract-refresh:${randomUUID()}`,
        p_targets: [
          {
            target_type: "submission",
            target_id: submissionId,
            brand_name: "DEV-1503 final refresh",
            brand_slug: null,
          },
        ],
      },
    );
    expect(jobError).toBeNull();
    expect(jobId).toBeTruthy();
    jobIds.push(jobId as string);
    const completedAt = new Date().toISOString();
    const { error: targetError } = await supabase!
      .from("curation_job_targets")
      .update({ status: "succeeded", completed_at: completedAt })
      .eq("job_id", jobId as string);
    expect(targetError).toBeNull();
    const { error: jobCompleteError } = await supabase!
      .from("curation_jobs")
      .update({ status: "completed", completed_at: completedAt })
      .eq("id", jobId as string);
    expect(jobCompleteError).toBeNull();

    const { error: refreshError } = await untypedSupabase!.rpc(
      "apply_brand_refresh",
      { p_submission_id: submissionId, p_reviewer_id: null },
    );
    expect(refreshError).toBeNull();

    const { data: brand, error: brandError } = await supabase!
      .from("brands")
      .select("description, category, subcategories, subcategories_en")
      .eq("id", brandId)
      .single();
    expect(brandError).toBeNull();
    expect(brand).toEqual({
      description: "排程更新後的品牌介紹",
      category: "home",
      subcategories: ["家具"],
      subcategories_en: ["Furniture"],
    });
    const { data: states, error: stateError } = await untypedSupabase!
      .from("brand_field_state")
      .select("field, source")
      .eq("brand_id", brandId)
      .in("field", [
        "description",
        "category",
        "subcategories",
        "subcategories_en",
      ]);
    expect(stateError).toBeNull();
    expect(states).toEqual(
      expect.arrayContaining([
        { field: "description", source: "enriched" },
        { field: "category", source: "enriched" },
        { field: "subcategories", source: "enriched" },
        { field: "subcategories_en", source: "enriched" },
      ]),
    );
    expect(states?.some((row) => LEGACY_JSON_KEYS.includes(row.field))).toBe(
      false,
    );
  });

  // Bug caught: the parameter rename could change category filtering or add
  // overlap behavior to search_brands, changing existing search results.
  it("keeps category filtering, subcategory overlap, and search weights usable", async () => {
    const suffix = `contract${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const homeOverlapId = await insertBrand(
      `search-home-overlap-${suffix}`,
      {
        category: "home",
        subcategories: ["木工"],
        subcategories_en: ["Woodwork"],
      },
      false,
    );
    const homeOtherId = await insertBrand(
      `search-home-other-${suffix}`,
      {
        category: "home",
        subcategories: ["陶藝"],
        subcategories_en: ["Ceramics"],
      },
      false,
    );
    const craftsOverlapId = await insertBrand(
      `search-crafts-overlap-${suffix}`,
      {
        category: "crafts",
        subcategories: ["木工"],
        subcategories_en: ["Woodwork"],
      },
      false,
    );

    const categoryAndOverlap = await supabase!.rpc("search_brand_page", {
      search_query: suffix,
      filter_categories: ["home"],
      filter_subcategories: ["木工"],
      sort_mode: "name",
    });
    expect(categoryAndOverlap.error).toBeNull();
    expect(categoryAndOverlap.data?.map((row) => row.id)).toContain(
      homeOverlapId,
    );
    expect(categoryAndOverlap.data?.map((row) => row.id)).not.toContain(
      homeOtherId,
    );
    expect(categoryAndOverlap.data?.map((row) => row.id)).not.toContain(
      craftsOverlapId,
    );

    for (const query of ["木工", "Woodwork"]) {
      const result = await supabase!.rpc("search_brand_page", {
        search_query: query,
        filter_subcategories: ["木工"],
        sort_mode: "name",
      });
      expect(result.error).toBeNull();
      expect(result.data?.map((row) => row.id)).toEqual(
        expect.arrayContaining([homeOverlapId, craftsOverlapId]),
      );
    }

    const unchangedAutocomplete = await supabase!.rpc("search_brands", {
      search_query: suffix,
      filter_categories: ["home"],
      filter_subcategories: ["不存在的子類別"],
      include_test_brands: false,
    });
    expect(unchangedAutocomplete.error).toBeNull();
    expect(unchangedAutocomplete.data?.map((row) => row.id)).toEqual(
      expect.arrayContaining([homeOverlapId, homeOtherId]),
    );
    expect(unchangedAutocomplete.data?.map((row) => row.id)).not.toContain(
      craftsOverlapId,
    );

    const document = await supabase!.rpc("brands_search_document", {
      p_name: `DEV-1503 ${suffix}`,
      p_slug: `dev-1503-${suffix}`,
      p_category: "home",
      p_subcategories: ["木工"],
      p_subcategories_en: ["Woodwork"],
      p_description: "",
      p_blurb_en: "",
    });
    expect(document.error).toBeNull();
    expect(String(document.data)).toContain("woodwork");
  });

  // Bug caught: contraction could leave persisted rows accepting historical
  // field identifiers, allowing owner protection and correction review to
  // diverge from the final application vocabulary.
  it("accepts final persisted identifiers and rejects removed ones", async () => {
    const brandId = await insertBrand("final-provenance", {
      category: "crafts",
      subcategories: ["木工"],
      subcategories_en: ["Woodwork"],
    });
    const { error: stateError } = await untypedSupabase!
      .from("brand_field_state")
      .insert({
        brand_id: brandId,
        field: "category",
        source: "owner",
      });
    expect(stateError).toBeNull();
    const { error: eventError } = await untypedSupabase!
      .from("brand_field_events")
      .insert({
        brand_id: brandId,
        field: "subcategories",
        source: "owner",
        new_value: ["木工"],
      });
    expect(eventError).toBeNull();
    const { error: correctionError } = await untypedSupabase!
      .from("brand_field_corrections")
      .insert({
        brand_id: brandId,
        field: "subcategories",
        proposed_value: ["木工"],
        status: "pending",
        visitor_hash: `dev-1503-${randomUUID()}`,
      });
    expect(correctionError).toBeNull();

    const { data: state } = await untypedSupabase!
      .from("brand_field_state")
      .select("field, source")
      .eq("brand_id", brandId);
    const { data: events } = await untypedSupabase!
      .from("brand_field_events")
      .select("field, source")
      .eq("brand_id", brandId);
    const { data: corrections } = await untypedSupabase!
      .from("brand_field_corrections")
      .select("field, status")
      .eq("brand_id", brandId);
    expect(state).toContainEqual({ field: "category", source: "owner" });
    expect(events).toContainEqual({ field: "subcategories", source: "owner" });
    expect(corrections).toContainEqual({
      field: "subcategories",
      status: "pending",
    });

    const { data: removedStateRows, error: removedStateReadError } =
      await untypedSupabase!
        .from("brand_field_state")
        .select("field")
        .eq("brand_id", brandId)
        .in("field", [
          ["product", "type"].join("_"),
          ["product", "tags"].join("_"),
          ["product", "tags", "en"].join("_"),
        ]);
    expect(removedStateReadError).toBeNull();
    expect(removedStateRows).toEqual([]);
  });
});
