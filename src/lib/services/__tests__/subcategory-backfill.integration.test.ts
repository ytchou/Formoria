import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { describeWithDb } from "@/test/setup";
import { latestAiResultIds } from "../_shared/ai-results";
import {
  PRE_MIGRATION_CORPUS,
  forwardSubcategories,
} from "../../../../scripts/rehearse-slug-reverse";
import {
  CRAFT_KIT_KEEPERS,
  CRAFT_KIT_SLUG,
  INTENTIONAL_ZERO_BRANDS,
  LABEL_MAP,
  MIGRATION_PATH,
  auditCorpus,
  brandSubcategorySlugs,
  parseMigrationTables,
  zeroSubcategoryBrands,
} from "../../../../scripts/backfill-subcategory-slugs";

/**
 * DEV-1510 Task 9. `supabase/migrations/20260820130000_backfill_subcategory_slugs.sql`
 * swaps the storage representation of `brands.subcategories` from zh-TW labels
 * to English slugs across seven surfaces at once.
 *
 * Two properties carry the whole task and neither is visible to a type checker:
 *
 *   1. Every stored string resolves to a slug or to a RECORDED removal, and
 *      anything else RAISES. A label that resolves to nothing is otherwise
 *      indistinguishable from one meant to be evicted — it would just quietly
 *      disappear, taking the brand off every L2 page with it.
 *   2. Exactly four brands reach zero subcategories, three unintentionally and
 *      one by design. A fifth means an eviction cost a brand its last tag; the
 *      Wave 2 rollback rehearsal found exactly that for `gshop`, which is why
 *      the 34-row `體驗課程・DIY材料` triage exists.
 *
 * Run scoped and env-armed — `describeWithDb` degrades to `describe.skip`
 * without `RUN_SUPABASE_INTEGRATION_TESTS=true`, and `isSafeTestDatabaseUrl`
 * additionally needs `SUPABASE_TEST_PROJECT_REF`, which neither env file sets.
 */

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

/** The three brands the ADR names as reaching zero UNINTENTIONALLY. */
const UNINTENDED_ZERO_BRANDS = ["dawn-creative", "homm-sound", "tp-minihorn"];

/**
 * Vitest runs test FILES in parallel workers, and several integration suites
 * seed approved brands carrying deliberately pre-migration fixture labels
 * (`DEV-1503 final-columns` holds `家飾`). Every live read below is corpus-wide,
 * so without this filter a green run depends on which other file happens to be
 * mid-test. Same pattern, same regex, as `search-cjk-recall.integration.test.ts`.
 */
const SEEDED_BRAND_NAME = /^DEV-\d+ |\[E2E-TEST\]/;

async function labelsToSlugs(labels: string[]): Promise<string[]> {
  const { data, error } = await untypedSupabase!.rpc(
    "subcategory_labels_to_slugs",
    { p_labels: labels },
  );
  expect(error).toBeNull();
  return (data ?? []) as string[];
}

describeWithDb("DEV-1510 subcategory slug backfill", () => {
  const brandIds: string[] = [];
  const submissionIds: string[] = [];
  const jobIds: string[] = [];
  let reviewerId = "";

  beforeAll(async () => {
    const { data, error } = await supabase!.auth.admin.createUser({
      email: `slug-backfill-reviewer-${randomUUID()}@formoria.com`,
      password: `Slug-backfill-${randomUUID()}`,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw error ?? new Error("Reviewer creation failed");
    }
    reviewerId = data.user.id;
  });

  afterEach(async () => {
    if (submissionIds.length > 0) {
      await supabase!
        .from("brand_submissions")
        .delete()
        .in("id", submissionIds);
      submissionIds.length = 0;
    }
    if (brandIds.length > 0) {
      await supabase!.from("brands").delete().in("id", brandIds);
      brandIds.length = 0;
    }
    if (jobIds.length > 0) {
      await supabase!.from("curation_jobs").delete().in("id", jobIds);
      jobIds.length = 0;
    }
  });

  afterAll(async () => {
    if (!reviewerId) return;
    await untypedSupabase!
      .from("admin_audit_log")
      .delete()
      .eq("admin_user_id", reviewerId);
    await supabase!.auth.admin.deleteUser(reviewerId);
  });

  it("dry_run_resolves_every_corpus_string", async () => {
    // 1/3 — the 2,446-string production corpus, committed brand-slug-keyed so
    // the evidence survives a fresh clone (docs/ is gitignored).
    const audit = auditCorpus(PRE_MIGRATION_CORPUS);
    expect(audit.brands).toBe(795);
    expect(audit.tagUses).toBe(2446);
    expect(audit.unresolved).toEqual([]);
    expect(audit.resolved + audit.removed).toBe(audit.tagUses);

    // 2/3 — the SQL copy of the map is generated from the same ontology. This
    // is what stops the migration's 861 rows from drifting away from
    // `ontology.ts` after a node is renamed.
    const migration = readFileSync(MIGRATION_PATH, "utf8");
    const parsed = parseMigrationTables(migration);
    expect(parsed.labelMap).toEqual(LABEL_MAP);
    expect(parsed.keepers).toEqual([...CRAFT_KIT_KEEPERS]);

    // 3/3 — the live column, re-read now rather than trusted from a snapshot,
    // and resolved by POSTGRES rather than by TypeScript. The two normalization
    // implementations agreeing is the property; a NFKC or middle-dot mismatch
    // would show up here and nowhere else.
    const { data, error } = await supabase!
      .from("brands")
      .select("name, slug, subcategories");
    expect(error).toBeNull();
    const live = (data ?? []).filter(
      (row) => !SEEDED_BRAND_NAME.test(row.name),
    );
    expect(live.length).toBeGreaterThan(0);

    const distinct = [
      ...new Set(live.flatMap((row) => row.subcategories ?? [])),
    ].toSorted();
    expect(distinct.length).toBeGreaterThan(0);
    expect(await labelsToSlugs(distinct)).toEqual(
      forwardSubcategories(distinct),
    );

    for (const row of live) {
      expect(auditCorpus({ [row.slug]: row.subcategories ?? [] }).unresolved)
        .toEqual([]);
    }
  });

  it("backfill_fails_on_an_unrecognised_string", async () => {
    const unknown = "完全沒有分類過的東西";

    // The SQL half. `maybeSingle`-free on purpose: the contract is that the
    // call ERRORS, not that it returns an empty array.
    const { data, error } = await untypedSupabase!.rpc(
      "subcategory_labels_to_slugs",
      { p_labels: [unknown] },
    );
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error?.message).toContain(unknown);

    // The TypeScript half, shared with the rollback rehearsal so the forward
    // model and the reverse cannot disagree about what "unresolved" means.
    expect(() => forwardSubcategories([unknown])).toThrow(/resolves to no slug/);

    // A recorded removal is the opposite outcome and must NOT raise: it is
    // dropped silently BECAUSE the drop is recorded.
    expect(await labelsToSlugs(["客製化禮品", "陶藝"])).toEqual(["ceramics"]);
  });

  it("exactly_three_brands_reach_zero_unintentionally", async () => {
    const zero = zeroSubcategoryBrands();
    expect(zero.unintended).toEqual(UNINTENDED_ZERO_BRANDS);
    expect(zero.intentional).toEqual([...INTENTIONAL_ZERO_BRANDS]);

    // The fifth-zero guard. Under a plain forward transform `gshop` loses its
    // only surviving tag; the triage is what puts it back. Asserting both
    // halves keeps a future edit from deleting the triage and "fixing" this
    // test by widening the expected zero set.
    const gshop = PRE_MIGRATION_CORPUS["gshop"] ?? [];
    expect(gshop.length).toBeGreaterThan(0);
    expect(forwardSubcategories(gshop)).toEqual([]);
    expect(brandSubcategorySlugs("gshop", gshop)).toEqual([CRAFT_KIT_SLUG]);

    // Non-vacuity guard: every check below passes trivially against an empty
    // catalogue, which would prove nothing about the backfill.
    const { count: approvedCount, error: countError } = await supabase!
      .from("brands")
      .select("slug", { count: "exact", head: true })
      .eq("status", "approved");
    expect(countError).toBeNull();
    expect(approvedCount ?? 0).toBeGreaterThan(0);

    // Against the live catalogue: no approved brand outside the recorded four
    // may hold an empty array. `{}` is the Postgres array literal and must go
    // through `.filter` — supabase-js serializes a JS `[]` to an empty string,
    // which Postgres rejects with `22P02 malformed array literal`, and the
    // rejection surfaces as an error rather than a failing assertion, so the
    // whole check silently stops running.
    const { data, error } = await supabase!
      .from("brands")
      .select("name, slug")
      .eq("status", "approved")
      .filter("subcategories", "eq", "{}");
    expect(error).toBeNull();
    const liveZero = (data ?? [])
      .filter((row) => !SEEDED_BRAND_NAME.test(row.name))
      .map((row) => row.slug)
      .toSorted();

    // Stated as "which slugs are unexpected" rather than `liveZero` against a
    // filter of itself — the self-comparison form holds for any input and so
    // reads as green whether or not the property is true.
    const allowedZero = new Set<string>([
      ...UNINTENDED_ZERO_BRANDS,
      ...INTENTIONAL_ZERO_BRANDS,
    ]);
    expect(liveZero.filter((slug) => !allowedZero.has(slug))).toEqual([]);
  });

  it("draft_data_camelcase_keys_are_converted", async () => {
    // `brands.draft_data` is keyed by BRAND_DRAFT_EDITABLE_KEYS
    // (`src/lib/services/brands.ts:486-503`), which is camelCase: `categorySlug`
    // and `subcategoriesEn`, not `category` and `subcategories_en`. A converter
    // that knew only the snake_case spelling would leave every draft on labels
    // and still report success.
    const { data, error } = await untypedSupabase!.rpc(
      "subcategory_json_to_slugs",
      {
        p_value: {
          name: "陶作坊",
          categorySlug: "crafts",
          subcategories: ["陶藝", "客製化禮品", "手工皮件"],
          subcategoriesEn: ["Ceramics", "Custom Gifts", "Leather Craft"],
          priceRange: 2,
        },
      },
    );
    expect(error).toBeNull();
    expect(data).toEqual({
      name: "陶作坊",
      // Already the storage representation — read, never rewritten.
      categorySlug: "crafts",
      subcategories: ["ceramics", "leather-craft"],
      // Re-DERIVED from the surviving slugs, not translated from the labels:
      // the evicted entry has to leave both arrays or they desynchronise.
      subcategoriesEn: ["Ceramics", "Leather Craft"],
      priceRange: 2,
    });

    // The snake_case container (`enriched_data`, `base_brand_data`) takes the
    // same path through the same function.
    const snake = await untypedSupabase!.rpc("subcategory_json_to_slugs", {
      p_value: {
        category: "crafts",
        subcategories: ["陶藝"],
        subcategories_en: ["Ceramics"],
      },
    });
    expect(snake.error).toBeNull();
    expect(snake.data).toEqual({
      category: "crafts",
      subcategories: ["ceramics"],
      subcategories_en: ["Ceramics"],
    });
  });

  it("approve_submission_converts_labels_on_read", async () => {
    const submissionId = randomUUID();
    const suffix = submissionId.slice(0, 8);
    const { error: submissionError } = await supabase!
      .from("brand_submissions")
      .insert({
        id: submissionId,
        brand_name: `DEV-1510 pre-deploy ${suffix}`,
        submitter_email: `slug-backfill-${suffix}@formoria.com`,
        description: "遷移前建立的送件，遷移後才被核准。",
        website_url: `https://pre-deploy-${suffix}.example.com`,
        status: "pending",
      });
    expect(submissionError).toBeNull();
    submissionIds.push(submissionId);

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
        p_started_by: "slug-backfill-test",
        p_trigger: "admin",
        p_parent_job_id: null,
        p_attempt: 1,
        p_scheduled_for: null,
        p_run_after: new Date().toISOString(),
        p_dedupe_key: `slug-backfill:${suffix}`,
        p_targets: [
          {
            target_type: "submission",
            target_id: submissionId,
            brand_name: `DEV-1510 pre-deploy ${suffix}`,
            brand_slug: null,
          },
        ],
      },
    );
    expect(jobError).toBeNull();
    jobIds.push(jobId as string);
    const completedAt = new Date().toISOString();
    await supabase!
      .from("curation_job_targets")
      .update({ status: "succeeded", completed_at: completedAt })
      .eq("job_id", jobId as string);
    await supabase!
      .from("curation_jobs")
      .update({ status: "completed", completed_at: completedAt })
      .eq("id", jobId as string);

    // The container a PRE-deploy submission carries: zh-TW labels, one of them
    // an alias spelling and one of them evicted.
    const { data: approval, error: approvalError } = await untypedSupabase!.rpc(
      "approve_submission",
      {
        p_submission_id: submissionId,
        p_reviewer_id: reviewerId,
        p_brand_data: {
          name: `DEV-1510 pre-deploy ${suffix}`,
          slug: `dev-1510-pre-deploy-${suffix}`,
          description: "遷移前建立的送件，遷移後才被核准。",
          category: "crafts",
          subcategories: ["陶藝", "手工皮件", "客製化禮品"],
          subcategories_en: ["Ceramics", "Leather Craft", "Custom Gifts"],
          price_range: 2,
          purchase_website: `https://pre-deploy-${suffix}.example.com`,
          is_demo: true,
          submitted_at: completedAt,
          approved_at: completedAt,
        },
      },
    );
    expect(approvalError).toBeNull();
    const approvedBrandId = (approval as Array<{ brand_id: string }>)[0]
      ?.brand_id;
    expect(approvedBrandId).toBeTruthy();
    brandIds.push(approvedBrandId!);

    const { data: brand, error: brandError } = await supabase!
      .from("brands")
      .select("subcategories, subcategories_en")
      .eq("id", approvedBrandId!)
      .single();
    expect(brandError).toBeNull();
    expect(brand?.subcategories).toEqual(["ceramics", "leather-craft"]);
    expect(brand?.subcategories_en).toEqual(["Ceramics", "Leather Craft"]);
  });

  it("ai_results_converts_only_latest_per_brand_per_phase", async () => {
    const brandId = randomUUID();
    const { error: brandError } = await supabase!.from("brands").insert({
      id: brandId,
      name: `DEV-1510 audit ${brandId.slice(0, 8)}`,
      slug: `dev-1510-audit-${brandId.slice(0, 8)}`,
      // `hidden` keeps the fixture off every public read while the audit rows
      // under test still hang off a real brand.
      status: "hidden",
      is_demo: true,
      category: "crafts",
    });
    expect(brandError).toBeNull();
    brandIds.push(brandId);

    const rows = [
      { id: randomUUID(), phase: "facts", createdAt: "2026-08-01T00:00:00Z" },
      { id: randomUUID(), phase: "facts", createdAt: "2026-08-02T00:00:00Z" },
      {
        id: randomUUID(),
        phase: "descriptions",
        createdAt: "2026-08-01T00:00:00Z",
      },
    ];
    const { error: insertError } = await untypedSupabase!
      .from("brand_ai_results")
      .insert(
        rows.map((row) => ({
          id: row.id,
          brand_id: brandId,
          phase: row.phase,
          model: "dev-1510-fixture",
          created_at: row.createdAt,
          subcategories: ["陶藝"],
        })),
      );
    expect(insertError).toBeNull();

    // The scope contract: latest row per target per phase, recency by
    // (created_at desc, id desc). Two of three rows move; the 2026-08-01
    // `facts` row is history and keeps the label the model actually returned.
    const latest = latestAiResultIds(
      rows.map((row) => ({
        id: row.id,
        brandId,
        submissionId: null,
        phase: row.phase,
        createdAt: row.createdAt,
      })),
    );
    expect(latest).toEqual(new Set([rows[1]!.id, rows[2]!.id]));

    for (const id of latest) {
      const { error: updateError } = await untypedSupabase!
        .from("brand_ai_results")
        .update({ subcategories: await labelsToSlugs(["陶藝"]) })
        .eq("id", id);
      expect(updateError).toBeNull();
    }

    const { data: after, error: readError } = await untypedSupabase!
      .from("brand_ai_results")
      .select("id, subcategories")
      .eq("brand_id", brandId);
    expect(readError).toBeNull();
    const byId = new Map(
      (after as Array<{ id: string; subcategories: string[] }>).map((row) => [
        row.id,
        row.subcategories,
      ]),
    );
    expect(byId.get(rows[0]!.id)).toEqual(["陶藝"]);
    expect(byId.get(rows[1]!.id)).toEqual(["ceramics"]);
    expect(byId.get(rows[2]!.id)).toEqual(["ceramics"]);

    // The migration's SQL half of the same scope. Ordering is the whole
    // contract here: audit rows for one phase are written in a tight loop and
    // share a millisecond routinely, so without the id tiebreak "latest" is
    // whichever row the planner happened to emit first.
    const migration = readFileSync(MIGRATION_PATH, "utf8");
    expect(migration).toContain(
      "select distinct on (coalesce(result.brand_id, result.submission_id), result.phase)",
    );
    expect(migration).toMatch(
      /result\.created_at desc,\s*\n\s*result\.id desc/,
    );
  });
});
