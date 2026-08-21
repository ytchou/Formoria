import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
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

/**
 * The migration's site 6/7 statement, lifted verbatim out of the SQL file.
 *
 * Read rather than re-typed: a copy in this file could be corrected while the
 * migration stayed wrong, which is the only failure the rehearsal below exists
 * to catch.
 */
function migrationSite6Statement(): string {
  const migration = readFileSync(MIGRATION_PATH, "utf8");
  const sectionStart = migration.indexOf("-- 6/7 — brand_ai_results");
  const sectionEnd = migration.indexOf("-- 7/7 —");
  expect(sectionStart, "site 6/7 header").toBeGreaterThan(-1);
  expect(sectionEnd).toBeGreaterThan(sectionStart);

  const section = migration.slice(sectionStart, sectionEnd);
  const start = section.indexOf("with latest as (");
  const end = section.indexOf(";", start);
  expect(start, "site 6/7 statement").toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  const statement = section.slice(start, end + 1);
  // Guards the extraction itself: a refactor that renames the CTE would
  // otherwise hand the rehearsal a fragment that trivially passes.
  expect(statement).toContain("distinct on");
  expect(statement).toContain("update public.brand_ai_results");
  return statement;
}

/**
 * Runs one statement against staging through the CLI, because PostgREST cannot
 * express `distinct on` and there is no exec RPC. Same harness as
 * `category-subcategory-expand.integration.test.ts`.
 *
 * Callers pass a `do` block that ends in `raise exception`, so the whole
 * rehearsal — fixtures included — rolls back and nothing is written to staging.
 * The raised message is the assertion channel: stderr carries it back here.
 */
function runSqlRehearsal(sql: string): string {
  if (!process.env.SUPABASE_DB_URL) {
    throw new Error("SUPABASE_DB_URL is required for the migration rehearsal");
  }
  try {
    return execFileSync(
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
        maxBuffer: 4 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
  }
}

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

    // Cross-implementation parity is asked on the PRE-migration labels, not on
    // the live column. Post-backfill the column holds slugs, and on a slug both
    // resolvers short-circuit to the identity — comparing them there compares
    // nothing, which is exactly how a U+FEFF or middle-dot divergence between
    // `subcategory_label_key` and `normalizeSubcategoryKey` would survive.
    // These are the strings that actually exercise both normalizers.
    const preMigrationLabels = [
      ...new Set(Object.values(PRE_MIGRATION_CORPUS).flat()),
    ].toSorted();
    expect(preMigrationLabels.length).toBeGreaterThan(distinct.length);
    expect(
      preMigrationLabels.some((label) => label !== forwardSubcategories([label])[0]),
      "the parity input must contain labels that are not already slugs",
    ).toBe(true);
    expect(await labelsToSlugs(preMigrationLabels)).toEqual(
      forwardSubcategories(preMigrationLabels),
    );

    // The live column is still checked for resolvability, which is a different
    // property: every stored string is one Postgres can map.
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
    expect(await labelsToSlugs(["客製化禮品", "餐具"])).toEqual(["tableware"]);
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
          categorySlug: "home",
          subcategories: ["餐具", "客製化禮品", "收納用品"],
          subcategoriesEn: ["Tableware", "Custom Gifts", "Storage"],
          priceRange: 2,
        },
      },
    );
    expect(error).toBeNull();
    expect(data).toEqual({
      name: "陶作坊",
      // Already the storage representation — read, never rewritten.
      categorySlug: "home",
      subcategories: ["tableware", "storage"],
      // Re-DERIVED from the surviving slugs, not translated from the labels:
      // the evicted entry has to leave both arrays or they desynchronise.
      subcategoriesEn: ["Tableware", "Storage"],
      priceRange: 2,
    });

    // The snake_case container (`enriched_data`, `base_brand_data`) takes the
    // same path through the same function.
    const snake = await untypedSupabase!.rpc("subcategory_json_to_slugs", {
      p_value: {
        category: "home",
        subcategories: ["餐具"],
        subcategories_en: ["Tableware"],
      },
    });
    expect(snake.error).toBeNull();
    expect(snake.data).toEqual({
      category: "home",
      subcategories: ["tableware"],
      subcategories_en: ["Tableware"],
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
          category: "home",
          subcategories: ["餐具", "收納用品", "客製化禮品"],
          subcategories_en: ["Tableware", "Storage", "Custom Gifts"],
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
    expect(brand?.subcategories).toEqual(["tableware", "storage"]);
    expect(brand?.subcategories_en).toEqual(["Tableware", "Storage"]);
  });

  it("ai_results_converts_only_latest_per_brand_per_phase", async () => {
    // ADR decision 6, of 31,320 production rows: history is the evidence a
    // replay depends on, so only the row a reader picks up is rewritten.
    //
    // Exercised by RUNNING the migration's own statement, not by asserting its
    // text. The rule lives in a `distinct on` PostgREST cannot express, so a
    // TypeScript re-implementation of the scope proves only that the
    // re-implementation agrees with itself. Everything happens inside a `do`
    // block that ends in `raise exception`, so the fixtures and the update roll
    // back and staging is left exactly as it was found.
    const statement = migrationSite6Statement();

    const output = runSqlRehearsal(`
do $rehearsal$
declare
  v_brand uuid := gen_random_uuid();
  v_facts_old uuid := gen_random_uuid();
  v_facts_new uuid := gen_random_uuid();
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_tie_low uuid;
  v_tie_high uuid;
  v_got text[];
begin
  if v_a < v_b then v_tie_low := v_a; v_tie_high := v_b;
  else v_tie_low := v_b; v_tie_high := v_a; end if;

  insert into public.brands (id, name, slug, status, is_demo, category)
  values (
    v_brand,
    'DEV-1510 site6 rehearsal',
    'dev-1510-site6-rehearsal-' || replace(v_brand::text, '-', ''),
    'hidden',
    true,
    'home'
  );

  -- Two phases for one brand, and inside 'descriptions' two rows sharing a
  -- created_at. Audit rows for one phase are written in a tight loop and share
  -- a millisecond routinely, so the same-timestamp pair is the only fixture
  -- that can tell the id tiebreak from no tiebreak at all.
  insert into public.brand_ai_results (id, brand_id, phase, model, created_at, subcategories)
  values
    (v_facts_old, v_brand, 'facts', 'dev-1510-fixture', '2026-08-01T00:00:00Z', array['餐具']),
    (v_facts_new, v_brand, 'facts', 'dev-1510-fixture', '2026-08-02T00:00:00Z', array['餐具']),
    (v_tie_low,   v_brand, 'descriptions', 'dev-1510-fixture', '2026-08-01T00:00:00Z', array['餐具']),
    (v_tie_high,  v_brand, 'descriptions', 'dev-1510-fixture', '2026-08-01T00:00:00Z', array['餐具']);

  ${statement}

  select subcategories into v_got from public.brand_ai_results where id = v_facts_new;
  if v_got is distinct from array['tableware'] then
    raise exception 'latest facts row was not converted: %', v_got;
  end if;

  select subcategories into v_got from public.brand_ai_results where id = v_facts_old;
  if v_got is distinct from array['餐具'] then
    raise exception 'history facts row was rewritten: %', v_got;
  end if;

  select subcategories into v_got from public.brand_ai_results where id = v_tie_high;
  if v_got is distinct from array['tableware'] then
    raise exception 'id tiebreak did not pick the higher id: %', v_got;
  end if;

  select subcategories into v_got from public.brand_ai_results where id = v_tie_low;
  if v_got is distinct from array['餐具'] then
    raise exception 'id tiebreak also converted the lower id: %', v_got;
  end if;

  raise exception 'DEV1510_SITE6_OK';
end
$rehearsal$;
`);

    // The harness reports the raised message. Any other message is a real
    // failure, and its text is the diff.
    expect(output).toContain("DEV1510_SITE6_OK");

    // Nothing survived the rollback.
    const { count, error: countError } = await untypedSupabase!
      .from("brand_ai_results")
      .select("id", { count: "exact", head: true })
      .eq("model", "dev-1510-fixture");
    expect(countError).toBeNull();
    expect(count).toBe(0);

    // The TypeScript half of the same scope, on the same discriminating
    // fixture. `latestAiResultIds` is what the application reads with, so it has
    // to break the created_at tie the way the migration did.
    const shared = "2026-08-01T00:00:00Z";
    const tie = [
      { id: "00000000-0000-4000-8000-00000000000a", phase: "descriptions", createdAt: shared },
      { id: "00000000-0000-4000-8000-00000000000b", phase: "descriptions", createdAt: shared },
      { id: "00000000-0000-4000-8000-00000000000c", phase: "facts", createdAt: shared },
      { id: "00000000-0000-4000-8000-00000000000d", phase: "facts", createdAt: "2026-08-02T00:00:00Z" },
    ].map((row) => ({
      ...row,
      brandId: "00000000-0000-4000-8000-0000000000b1",
      submissionId: null,
    }));

    expect(latestAiResultIds(tie)).toEqual(
      new Set([
        "00000000-0000-4000-8000-00000000000b",
        "00000000-0000-4000-8000-00000000000d",
      ]),
    );

    // A different target is a different group, even at the same timestamp.
    expect([
      ...latestAiResultIds([
        ...tie,
        {
          id: "00000000-0000-4000-8000-000000000001",
          brandId: null,
          submissionId: "submission-1",
          phase: "facts",
          createdAt: shared,
        },
      ]),
    ]).toContain("00000000-0000-4000-8000-000000000001");
  });});
