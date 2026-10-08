import { normalizeCuratedProductName } from "@/lib/curated-products/product-name";
import { requestPublicBrandRevalidation } from "@/lib/cache/revalidate-client";
import { createServiceClient } from "@/lib/supabase/service";

import { loadScriptTarget } from "../../../shared/target";
import {
  assertRevalidationConfigured,
  fetchAllRows,
  parseApplyOption,
  parseBrandOption,
} from "./shared";

/**
 * Normalises stored `curated_products.name_zh` / `name_en` (DEV-1962).
 *
 * WRITTEN FOR DEV-1962 AND NOT EXECUTED AS PART OF ITS PR. Run it against
 * staging first, read the dry-run output, and only then consider production.
 *
 *   pnpm exec tsx scripts/enrichment/products/curated-products/normalize-names.ts
 *   …--brand=<slug>          one brand only
 *   …--apply                 write the fixes (dry run without it)
 *   …--target=production     defaults to staging; see scripts/shared/target.ts
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
function normalized(name: string): string {
  return normalizeCuratedProductName(name) || name;
}

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
  const { argv } = loadScriptTarget();
  const apply = parseApplyOption(argv);
  const brandSlug = parseBrandOption(argv);
  // Preflight BEFORE the first write: a write that lands while revalidation is
  // unconfigured leaves every touched brand page serving its hour-old shell.
  if (apply) assertRevalidationConfigured();

  const rows = await loadRows(brandSlug);
  const plan = planNameFixes(rows);
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
