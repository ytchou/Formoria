/**
 * DEV-1309 remediation: clear the contaminated `purchase_website` values that
 * current code can no longer re-derive.
 *
 *   # 1. produce the report (read-only)
 *   pnpm exec tsx --env-file=.env.local scripts/site-identity-eval/exposure-scan.ts \
 *     --out scripts/site-identity-eval/runs/exposure.json
 *
 *   # 2. dry run: what would be cleared
 *   pnpm exec tsx --env-file=.env.local scripts/clear-dev-1309-websites.ts \
 *     --report scripts/site-identity-eval/runs/exposure.json
 *
 *   # 3. clear
 *   pnpm exec tsx --env-file=.env.local scripts/clear-dev-1309-websites.ts \
 *     --report scripts/site-identity-eval/runs/exposure.json --apply
 *
 * ## Why this reads a report instead of re-deriving the set
 *
 * The contaminated/stale decision is `exposure-scan.ts`'s, and duplicating it
 * here would let the two drift — the failure mode being a script that clears a
 * row the scan considers live-writable. Requiring the report makes the scan a
 * mandatory step and keeps one source of truth. The report is re-read against
 * live rows before every write, so a stale report cannot clear a value that has
 * since changed.
 *
 * ## What it refuses to do
 *
 * - Clear a row the report marks `liveWritable`. Those revert on the next
 *   curation run, and a value that reappears looks like a regression rather than
 *   an un-remediated row. They are listed and skipped.
 * - Clear a row whose live `purchase_website` no longer matches the report.
 *   Something changed since the scan; re-run it.
 * - Clear a brand that is not in the cohort, when `--cohort` is passed.
 *
 * Every clear is recorded in `brand_field_events` with the old value, matching
 * `clear-contaminated-links.ts` — the `brands` table has no audit trigger, so a
 * script that updates directly must write the event itself or the cleared value
 * becomes unrecoverable.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");

type ExposureRow = {
  slug: string;
  name: string | null;
  status: string;
  purchaseWebsite: string;
  contamination: string;
  liveWritable: boolean;
};

type ExposureReport = {
  ranAt: string;
  rows: ExposureRow[];
};

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv.at(index + 1);
}

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  return createSupabaseClient(url, serviceRoleKey);
}

async function loadReport(path: string): Promise<ExposureReport> {
  const raw = await readFile(resolve(path), "utf8");
  const parsed = JSON.parse(raw) as Partial<ExposureReport>;
  if (!Array.isArray(parsed.rows)) {
    throw new Error(`${path} has no rows[] — is it an exposure-scan report?`);
  }
  return { ranAt: parsed.ranAt ?? "unknown", rows: parsed.rows };
}

/** The cohort's slugs, or `null` when no `--cohort` was passed (report is the whole scope). */
async function loadCohortSlugs(ref: string | undefined): Promise<Set<string> | null> {
  if (!ref) return null;
  const path = ref.includes("/")
    ? resolve(ref)
    : resolve("scripts/curation-cohorts", `${ref}.json`);
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as { labels?: Record<string, string> };
  return new Set(Object.keys(parsed.labels ?? {}));
}

async function main(): Promise<void> {
  const reportPath = argValue("--report");
  if (!reportPath) {
    throw new Error(
      "--report <path> is required. Run scripts/site-identity-eval/exposure-scan.ts --out <path> first.",
    );
  }

  const supabase = createServiceClient();
  const report = await loadReport(reportPath);
  const cohortSlugs = await loadCohortSlugs(argValue("--cohort"));

  console.log(`report:  ${reportPath} (scanned ${report.ranAt})`);
  console.log(`cohort:  ${cohortSlugs ? `${cohortSlugs.size} slug(s)` : "none — whole report"}`);
  console.log(`rows:    ${report.rows.length} contaminated\n`);

  const skippedLive = report.rows.filter((row) => row.liveWritable);
  const outOfCohort = report.rows.filter(
    (row) => !row.liveWritable && cohortSlugs !== null && !cohortSlugs.has(row.slug),
  );
  const candidates = report.rows.filter(
    (row) => !row.liveWritable && (cohortSlugs === null || cohortSlugs.has(row.slug)),
  );

  if (skippedLive.length > 0) {
    console.log(`## SKIPPED — live-writable, clearing would revert (${skippedLive.length})`);
    for (const row of skippedLive) {
      console.log(`  ${row.slug.padEnd(28)} ${row.contamination.padEnd(18)} ${row.purchaseWebsite}`);
    }
    console.log();
  }

  if (outOfCohort.length > 0) {
    console.log(`## SKIPPED — stale but not in the cohort (${outOfCohort.length})`);
    for (const row of outOfCohort) {
      console.log(`  ${row.slug.padEnd(28)} ${row.purchaseWebsite}`);
    }
    console.log();
  }

  console.log(`## TO CLEAR (${candidates.length})`);
  for (const row of candidates) {
    console.log(`  ${row.slug.padEnd(28)} ${row.contamination.padEnd(18)} ${row.purchaseWebsite}`);
  }
  console.log();

  if (!APPLY) {
    console.log("Dry run. Re-run with --apply to clear.");
    return;
  }

  let cleared = 0;
  for (const row of candidates) {
    // Re-read the live value: the report may predate a change, and clearing a
    // value the operator never saw is exactly what the report is meant to prevent.
    const { data, error: readError } = await supabase
      .from("brands")
      .select("id, purchase_website")
      .eq("slug", row.slug)
      .maybeSingle();

    if (readError) {
      console.error(`  FAILED ${row.slug}: ${readError.message}`);
      continue;
    }
    if (!data) {
      console.error(`  SKIPPED ${row.slug}: no such brand`);
      continue;
    }
    if (data.purchase_website !== row.purchaseWebsite) {
      console.error(
        `  SKIPPED ${row.slug}: live value changed since the scan (${data.purchase_website ?? "null"}) — re-run the scan`,
      );
      continue;
    }

    const { error: updateError } = await supabase
      .from("brands")
      .update({ purchase_website: null })
      .eq("id", data.id);

    if (updateError) {
      console.error(`  FAILED ${row.slug}: ${updateError.message}`);
      continue;
    }

    const { error: eventError } = await supabase.from("brand_field_events").insert({
      brand_id: data.id,
      field: "purchase_website",
      old_value: row.purchaseWebsite,
      new_value: null,
      source: "admin",
    });

    if (eventError) {
      console.error(
        `  WARNING ${row.slug}: cleared but not audited — ${eventError.message}`,
      );
    }

    cleared += 1;
    console.log(`  ${row.slug} — cleared`);
  }

  console.log(`\nCleared ${cleared}/${candidates.length} field(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
