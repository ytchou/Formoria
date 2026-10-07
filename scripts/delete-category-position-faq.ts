/**
 * @formoria-script
 * purpose: Deletes model-authored category-position FAQ rows; dry run unless --apply.
 * class: operator
 * invoke: pnpm exec tsx scripts/delete-category-position-faq.ts
 * target: staging-default
 * safety: writes-on-apply
 * owner: engineering
 * notes: DEV-1954 one-off; NOT run yet — a reviewer reads the dry run first
 */
/**
 * DEV-1954 / BD-19: remove the stored `category-position` FAQ rows.
 *
 * The preset is no longer authored (`authorable: () => false`): the category
 * already shows on the brand page, and the model wrote the question 25+ ways,
 * some of them asking about other brands (「文具設計類別包含哪些品牌？」). This
 * clears the rows already written.
 *
 * NOT run as part of the change that shipped it. A reviewer reads the dry run
 * against staging first, then production (`--target production`), before
 * anyone passes `--apply`.
 *
 * Only `source = 'model'` rows are deleted. Human copy (an owner's or an
 * admin's own words) is never deleted — the same rule `brand-faq.ts` applies to
 * overwrites and to orphaned custom rows — and is reported as skipped.
 *
 * Side effect to read in the dry run: each deleted model row decrements
 * `brands.model_faq_count` through its trigger, and `seo_promoted` accepts
 * `model_faq_count >= 3` in place of a city. A brand with no city at the
 * threshold leaves the sitemap; those brands are listed before any delete.
 *
 * Usage:
 *   pnpm exec tsx scripts/delete-category-position-faq.ts                       # dry run, staging
 *   pnpm exec tsx scripts/delete-category-position-faq.ts --target production   # dry run, production
 *   pnpm exec tsx scripts/delete-category-position-faq.ts --apply               # delete, staging
 */
import { createServiceClient } from "@/lib/supabase/service";
import { loadScriptTarget } from "./shared/target";

const PRESET_ID = "category-position";
// PostgREST caps an unpaged select at 1000 rows.
const PAGE = 1000;
// Mirrors the FAQ arm of the `seo_promoted` generated column
// (20260808150000_brand_seo_promotion_bar.sql).
const SEO_PROMOTION_FAQ_FLOOR = 3;

export type CategoryPositionRow = {
  brandId: string;
  brandSlug: string;
  position: number;
  questionZh: string | null;
  source: string;
  brandCity: string | null;
  modelFaqCount: number;
  seoPromoted: boolean;
};

export type CategoryPositionReport = {
  total: number;
  /** Row count per `source`, sorted by source. */
  bySource: [source: string, count: number][];
  /** Rows `--apply` deletes. */
  deletable: CategoryPositionRow[];
  /** Human rows `--apply` leaves in place. */
  skippedHuman: CategoryPositionRow[];
  /** Promoted brands whose only promotion arm left is the FAQ count, dropping below the floor. */
  losesSeoPromotion: string[];
};

function hasCity(city: string | null): boolean {
  return city != null && city.trim() !== "";
}

export function summarizeCategoryPositionRows(
  rows: readonly CategoryPositionRow[],
): CategoryPositionReport {
  const counts = new Map<string, number>();
  for (const row of rows)
    counts.set(row.source, (counts.get(row.source) ?? 0) + 1);

  const deletable = rows.filter((row) => row.source === "model");
  const skippedHuman = rows.filter((row) => row.source !== "model");

  const deletedPerBrand = new Map<string, CategoryPositionRow[]>();
  for (const row of deletable)
    deletedPerBrand.set(row.brandId, [
      ...(deletedPerBrand.get(row.brandId) ?? []),
      row,
    ]);
  const losesSeoPromotion = [...deletedPerBrand.values()]
    .flatMap((brandRows) => {
      const brand = brandRows[0];
      if (!brand?.seoPromoted || hasCity(brand.brandCity)) return [];
      return brand.modelFaqCount - brandRows.length < SEO_PROMOTION_FAQ_FLOOR
        ? [brand.brandSlug]
        : [];
    })
    .sort();

  return {
    total: rows.length,
    bySource: [...counts].sort(([left], [right]) => left.localeCompare(right)),
    deletable,
    skippedHuman,
    losesSeoPromotion,
  };
}

type FaqRowWithBrand = {
  brand_id: string;
  position: number;
  question_zh: string | null;
  source: string;
  brands: {
    slug: string;
    city: string | null;
    model_faq_count: number;
    seo_promoted: boolean;
  } | null;
};

async function readCategoryPositionRows(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<CategoryPositionRow[]> {
  const rows: CategoryPositionRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("brand_faq_entries")
      .select(
        "brand_id, position, question_zh, source, brands(slug, city, model_faq_count, seo_promoted)",
      )
      .eq("preset_id", PRESET_ID)
      .order("brand_id", { ascending: true })
      .order("position", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error)
      throw new Error(`brand_faq_entries read failed: ${error.message}`);
    const page = (data ?? []) as unknown as FaqRowWithBrand[];
    for (const row of page) {
      rows.push({
        brandId: row.brand_id,
        brandSlug: row.brands?.slug ?? `(unknown brand ${row.brand_id})`,
        position: row.position,
        questionZh: row.question_zh,
        source: row.source,
        brandCity: row.brands?.city ?? null,
        modelFaqCount: row.brands?.model_faq_count ?? 0,
        seoPromoted: row.brands?.seo_promoted ?? false,
      });
    }
    if (page.length < PAGE) break;
  }
  return rows;
}

function describeRow(row: CategoryPositionRow): string {
  return `  [${row.source}] ${row.brandSlug} #${row.position} ${row.questionZh ?? "(no zh question)"}`;
}

async function main(): Promise<void> {
  const { argv } = loadScriptTarget();
  const apply = argv.includes("--apply");
  console.log(
    `[delete-category-position-faq] mode: ${apply ? "APPLY" : "DRY RUN (pass --apply)"}`,
  );

  const supabase = createServiceClient();
  const report = summarizeCategoryPositionRows(
    await readCategoryPositionRows(supabase),
  );

  console.log(`\nrows with preset_id = '${PRESET_ID}': ${report.total}`);
  for (const [source, count] of report.bySource)
    console.log(`  source=${source}: ${count}`);

  console.log(`\nwould delete (source = 'model'): ${report.deletable.length}`);
  for (const row of report.deletable) console.log(describeRow(row));

  console.log(
    `\nskipped, never deleted (human copy): ${report.skippedHuman.length}`,
  );
  for (const row of report.skippedHuman) console.log(describeRow(row));

  console.log(
    `\nbrands leaving seo_promoted (no city, model FAQ count drops below ${SEO_PROMOTION_FAQ_FLOOR}): ${report.losesSeoPromotion.length}`,
  );
  for (const slug of report.losesSeoPromotion) console.log(`  ${slug}`);

  if (!apply) return;

  // One filtered delete rather than per-key deletes: the filter IS the
  // selection the report above printed, and `source = 'model'` is enforced by
  // the database, not by this loop.
  const { count, error } = await supabase
    .from("brand_faq_entries")
    .delete({ count: "exact" })
    .eq("preset_id", PRESET_ID)
    .eq("source", "model");
  if (error) throw new Error(`brand_faq_entries delete failed: ${error.message}`);

  console.log(`\n[delete-category-position-faq] deleted: ${count ?? 0}`);
  if ((count ?? 0) !== report.deletable.length)
    console.warn(
      `[delete-category-position-faq] deleted ${count ?? 0}, dry-run count was ${report.deletable.length} — rows changed between read and delete`,
    );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
