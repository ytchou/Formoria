import { writeFileSync } from "node:fs";

import { publicCuratedProductName } from "@/lib/curated-products/product-name";
import { requestPublicBrandRevalidation } from "@/lib/cache/revalidate-client";
import { createServiceClient } from "@/lib/supabase/service";

import { escapeCsvField } from "../../eval/search-eval/label-shared";
import { loadScriptTarget, type ScriptTarget } from "../../../shared/target";
import {
  assertRevalidationConfigured,
  fetchAllRows,
  parseApplyOption,
  parseBrandOption,
  parseCsvPath,
} from "./shared";

/**
 * Normalises stored `curated_products.name_zh` / `name_en` (DEV-1962).
 *
 * Written for DEV-1962, which did not run it; DEV-1989 (DS2-01) ran it on
 * staging. Run it against staging first, read the dry-run output, and only
 * then consider production.
 *
 *   pnpm exec tsx scripts/enrichment/products/curated-products/normalize-names.ts
 *   …--brand=<slug>          one brand only
 *   …--apply                 write the fixes (dry run without it)
 *   …--csv=<path>            rollback CSV path; defaults to
 *                            normalize-names-<target>-<timestamp>.csv in the cwd
 *   …--target=production     defaults to staging; see scripts/shared/target.ts
 *
 * ROLLBACK: every run, dry or not, writes a CSV of each planned fix (id, brand
 * slug, both names before and after) BEFORE any write. Restoring a row is
 * `updateCuratedProduct(id, { nameZh: before, nameEn: before })` per line —
 * note that the write path normalises again, so a restore through the service
 * cannot bring a token back; that needs a direct column write.
 *
 * REVALIDATION ON STAGING IS SKIPPED. `.env.staging` deliberately carries no
 * ORIGIN_SECRET / FORMORIA_RAILWAY_URL (the old values pointed at production's
 * origin), so staging has no revalidation route. A staging run skips the
 * preflight and the post-write request and says so; its pages pick the change
 * up by ISR (1h) or a staging redeploy. Production keeps both. Upgrade path:
 * give staging its own origin secret and URL, then drop the skip.
 *
 * The 2026-10-08 public catalog scan found 173 of 1,366 names ending in a
 * shop's random SKU token (「Your Monkey 眼鏡架兼存錢筒 7cFSL8yz」) and 5 names
 * written twice (「啵啵杯710ml 啵啵杯710ml」). The write paths now normalise on
 * the way in; this script repairs the rows stored before they did. The rule is
 * `normalizeCuratedProductName`, never a second copy of it.
 *
 * DUPLICATES ARE REPORTED, NEVER MERGED. Two rows of one brand that normalise
 * to the same name are either the same product listed twice or two variants
 * the shop told apart only by the token. Which one it is, and which row
 * survives, is an editorial decision this script has no basis to make.
 *
 * WRITE SCOPE: the two name columns, through `updateCuratedProduct` so the
 * service's audit trail and vocabulary report see the change. `key` is NOT
 * rewritten: it is the row's stable identifier, and changing it would orphan
 * anything that refers to the old one.
 */

const PAGE_SIZE = 500;

export type NameRow = {
  id: string;
  brand_id: string;
  name_zh: string;
  name_en: string | null;
  visible: boolean;
  /** Embedded so a successful apply can revalidate the pages it changed. */
  brands?: { slug: string } | { slug: string }[] | null;
};

type Names = { nameZh: string; nameEn: string | null };

export type NameFix = {
  id: string;
  brandId: string;
  brandSlug: string | null;
  visible: boolean;
  before: Names;
  after: Names;
};

export type DuplicateNameGroup = {
  brandId: string;
  brandSlug: string | null;
  /** The shared name after normalisation. */
  nameZh: string;
  members: { id: string; nameZh: string; visible: boolean }[];
};

export type NamePlan = {
  fixes: NameFix[];
  duplicateNames: DuplicateNameGroup[];
};

/** PostgREST returns a to-one embed as an object here and an array elsewhere. */
function brandSlugOf(row: NameRow): string | null {
  const brands = Array.isArray(row.brands) ? row.brands[0] : row.brands;
  return brands?.slug ?? null;
}

/** A normalised name, or the stored one when normalising would empty it. */
const normalized = publicCuratedProductName;

/**
 * Pure: which rows change under `normalizeCuratedProductName`, and which rows
 * of one brand collide once they do. Input order is kept, so a stable read
 * order gives a stable plan.
 */
export function planNameFixes(rows: readonly NameRow[]): NamePlan {
  const fixes: NameFix[] = [];
  const groups = new Map<string, DuplicateNameGroup>();

  for (const row of rows) {
    const before: Names = { nameZh: row.name_zh, nameEn: row.name_en };
    const after: Names = {
      nameZh: normalized(row.name_zh),
      nameEn: row.name_en === null ? null : normalized(row.name_en),
    };
    const brandSlug = brandSlugOf(row);

    if (after.nameZh !== before.nameZh || after.nameEn !== before.nameEn) {
      fixes.push({
        id: row.id,
        brandId: row.brand_id,
        brandSlug,
        visible: row.visible,
        before,
        after,
      });
    }

    const groupKey = `${row.brand_id}\u0000${after.nameZh}`;
    const group = groups.get(groupKey) ?? {
      brandId: row.brand_id,
      brandSlug,
      nameZh: after.nameZh,
      members: [],
    };
    group.members.push({
      id: row.id,
      nameZh: row.name_zh,
      visible: row.visible,
    });
    groups.set(groupKey, group);
  }

  return {
    fixes,
    duplicateNames: [...groups.values()].filter(
      (group) => group.members.length > 1,
    ),
  };
}

/** The service write, injected so the test never mocks `@/lib/services/`. */
export type UpdateName = (
  id: string,
  input: { nameZh?: string; nameEn?: string | null },
) => Promise<void>;

export type ApplyReport = {
  /** What a `--apply` run WOULD write; equals `written` once it does. */
  intended: number;
  written: number;
  /** Brand slugs whose rows were actually written, for revalidation. */
  writtenBrandSlugs: string[];
  failures: string[];
};

/**
 * Sequential on purpose: a few hundred single-row updates finish in seconds,
 * and one at a time keeps the audit trail in the same order as the output.
 */
export async function applyNameFixes({
  fixes,
  apply,
  update,
}: {
  fixes: readonly NameFix[];
  apply: boolean;
  update: UpdateName;
}): Promise<ApplyReport> {
  const report: ApplyReport = {
    intended: fixes.length,
    written: 0,
    writtenBrandSlugs: [],
    failures: [],
  };
  if (!apply) return report;

  const writtenBrandSlugs = new Set<string>();
  for (const fix of fixes) {
    // Only the column that changed: an unchanged name is not rewritten.
    const input: { nameZh?: string; nameEn?: string | null } = {};
    if (fix.after.nameZh !== fix.before.nameZh) input.nameZh = fix.after.nameZh;
    if (fix.after.nameEn !== fix.before.nameEn) input.nameEn = fix.after.nameEn;
    try {
      await update(fix.id, input);
      report.written += 1;
      if (fix.brandSlug) writtenBrandSlugs.add(fix.brandSlug);
    } catch (error: unknown) {
      // Counted and carried, never thrown: one failed row must not end a run
      // that has already written an arbitrary prefix of the rest.
      report.failures.push(
        `${fix.id} (${fix.brandSlug ?? "?"}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  report.writtenBrandSlugs = [...writtenBrandSlugs].sort();
  return report;
}

const ROLLBACK_CSV_COLUMNS = [
  "id",
  "brand_slug",
  "before_name_zh",
  "before_name_en",
  "after_name_zh",
  "after_name_en",
] as const;

/**
 * Pure: the rollback CSV for a plan, one row per fix, header first. A null
 * English name is an empty cell. Written before any `--apply` write, so the
 * file exists even when the run dies mid-way.
 */
export function buildRollbackCsv(fixes: readonly NameFix[]): string {
  const lines = [ROLLBACK_CSV_COLUMNS.join(",")];
  for (const fix of fixes) {
    lines.push(
      [
        fix.id,
        fix.brandSlug ?? "",
        fix.before.nameZh,
        fix.before.nameEn ?? "",
        fix.after.nameZh,
        fix.after.nameEn ?? "",
      ]
        .map(escapeCsvField)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

/** `normalize-names-staging-2026-10-09T01-02-03.456Z.csv`: colons are not path-safe everywhere. */
export function defaultRollbackCsvPath(target: ScriptTarget, now: Date): string {
  return `normalize-names-${target}-${now.toISOString().replaceAll(":", "-")}.csv`;
}

/**
 * Printed instead of revalidating on staging, which has no revalidation route.
 * Shared with repair-missing-images.ts so both scripts say the same thing.
 */
export const STAGING_REVALIDATION_SKIPPED = {
  revalidation: "skipped",
  reason:
    "staging has no revalidation route (no ORIGIN_SECRET / FORMORIA_RAILWAY_URL in .env.staging); pages refresh by ISR (1h) or a staging redeploy",
} as const;

/** Paged with a stable order: an unpaged read stops at `db-max-rows`. */
async function loadRows(brandSlug: string | null): Promise<NameRow[]> {
  const supabase = createServiceClient();
  return fetchAllRows<NameRow>(
    "curated_products",
    (from, to) => {
      let query = supabase
        .from("curated_products")
        .select("id, brand_id, name_zh, name_en, visible, brands!inner(slug)");
      if (brandSlug) query = query.eq("brands.slug", brandSlug);
      return query.order("id", { ascending: true }).range(from, to);
    },
    PAGE_SIZE,
  );
}

async function main(): Promise<void> {
  // Strips `--target` and proves the credentials belong to that project
  // before any client opens. Staging is the default.
  const { target, argv } = loadScriptTarget();
  const apply = parseApplyOption(argv);
  const brandSlug = parseBrandOption(argv);
  const csvPath = parseCsvPath(argv) ?? defaultRollbackCsvPath(target, new Date());
  // Staging has no revalidation route — see the header.
  const revalidate = target !== "staging";
  // Preflight BEFORE the first write: a write that lands while revalidation is
  // unconfigured leaves every touched brand page serving its hour-old shell.
  if (apply && revalidate) assertRevalidationConfigured();

  const rows = await loadRows(brandSlug);
  const plan = planNameFixes(rows);
  // Before any write, so a run that dies mid-way still leaves its rollback.
  writeFileSync(csvPath, buildRollbackCsv(plan.fixes));
  console.log(JSON.stringify({ rollbackCsv: csvPath, rows: plan.fixes.length }));
  // Imported here, not at the top: the test imports this module for its pure
  // functions and has no reason to load the whole curated-product service.
  const { updateCuratedProduct } = await import(
    "@/lib/services/curated-products"
  );
  const report = await applyNameFixes({
    fixes: plan.fixes,
    apply,
    update: (id, input) => updateCuratedProduct(id, input),
  });

  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      brand: brandSlug,
      selected: rows.length,
      fixes: plan.fixes.length,
      visibleFixes: plan.fixes.filter((fix) => fix.visible).length,
      duplicateNameGroups: plan.duplicateNames.length,
      ...report,
      writtenBrandSlugs: report.writtenBrandSlugs.length,
      failures: report.failures.length,
    }),
  );
  for (const fix of plan.fixes) {
    const before = [fix.before.nameZh, fix.before.nameEn]
      .filter(Boolean)
      .join(" / ");
    const after = [fix.after.nameZh, fix.after.nameEn]
      .filter(Boolean)
      .join(" / ");
    console.log(`${fix.brandSlug ?? "?"} | ${fix.id} | ${before} → ${after}`);
  }
  for (const group of plan.duplicateNames) {
    console.log(JSON.stringify({ duplicateName: group }));
  }
  for (const failure of report.failures) {
    console.log(JSON.stringify({ failed: failure }));
  }
  if (report.failures.length > 0) process.exitCode = 1;

  if (!apply) {
    console.log("No changes made. Re-run with --apply to write.");
    return;
  }
  if (report.written === 0) return;
  if (!revalidate) {
    console.log(JSON.stringify(STAGING_REVALIDATION_SKIPPED));
    return;
  }

  // Without this every touched brand page keeps serving the old name from its
  // ISR shell for up to an hour, and the run still exits clean.
  const revalidation = await requestPublicBrandRevalidation(
    report.writtenBrandSlugs,
  );
  console.log(
    JSON.stringify({
      revalidated: report.writtenBrandSlugs.length,
      ok: revalidation.ok,
      reason: revalidation.reason ?? null,
    }),
  );
  if (!revalidation.ok) {
    // The names are already committed, so this cannot be undone here — but it
    // must never exit 0 while the pages still show the old names.
    throw new Error(
      `revalidation failed (${revalidation.reason ?? "unknown"}): brand pages are stale`,
    );
  }
}

// The test imports the pure functions from this module, so importing it must
// never start a run. `main()` fires only when this file IS the process entry
// point — under vitest argv[1] is the runner, not this file.
if (process.argv[1]?.endsWith("curated-products/normalize-names.ts")) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
