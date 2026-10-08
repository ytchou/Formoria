/**
 * @formoria-script
 * purpose: Re-files the BD2-26 mis-tagged curated products (enjoy-caster, rmc) and folds full-width letters in the rmc story.
 * class: operator
 * invoke: pnpm exec tsx scripts/enrichment/products/curated-products/fix-bd2-26-taxonomy.ts
 * target: staging-default
 * safety: writes-on-apply
 * owner: engineering
 * notes: Dry run by default; --apply writes a rollback JSON under scripts/backup/ first. Production needs an explicit --target=production.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { subcategoryBySlug } from "@/lib/taxonomy/ontology";

import type { ScriptTarget } from "../../../shared/target";
import { assertRevalidationConfigured, fetchAllRows, parseApplyOption } from "./shared";

/**
 * BD2-26 data fix (DEV-1989), an explicit list — not a classifier.
 *
 *   pnpm exec tsx scripts/enrichment/products/curated-products/fix-bd2-26-taxonomy.ts
 *   …--apply                 write (dry run without it)
 *   …--target=production     staging is the default; production only when named
 *
 * Rows are matched by brand slug and product name, and ids are looked up at
 * run time. A rule that matches nothing is printed as not found, never thrown:
 * staging is a snapshot and a row may already be fixed or renamed.
 *
 * WRITE PATHS. Products: `updateCuratedProduct` with `category` and
 * `subcategory` together (the service refuses one without the other, and hides
 * a row whose L2 is not in its L1 — so the L1 is always taken from the L2).
 * The rmc story: `updateBrand` with the admin actor, the path the admin edit
 * form uses. No `userId` is passed, so the field is not admin-locked and a
 * later brand refresh may still rewrite the story.
 */

// ---------------------------------------------------------------------------
// The fix list
// ---------------------------------------------------------------------------

export type TaxonomyRule = {
  brandSlug: string;
  /** Exact `name_zh` values; each one that matches no row is reported. */
  exactNames: readonly string[];
  /** Case-insensitive name keywords; only rows whose current L2 is in `fromSubcategories`. */
  keywords: readonly string[];
  fromSubcategories: readonly string[];
  toSubcategory: string;
  reason: string;
};

export const TAXONOMY_RULES: readonly TaxonomyRule[] = [
  {
    brandSlug: "enjoy-caster",
    exactNames: ["60mm PU辦公椅腳輪"],
    keywords: [],
    fromSubcategories: [],
    // An office-chair caster is a furniture part. `hand-tools` names tools
    // (screwdrivers, wrenches); `furniture` already carries the chair alias,
    // and no furniture-hardware L2 exists in the ontology. Same L1 (home).
    toSubcategory: "furniture",
    reason: "office-chair caster is a furniture part, not a hand tool",
  },
  {
    brandSlug: "rmc",
    exactNames: ["立體刺繡 3D EMBROIDERY", "夜光材料 GLOW IN THE DARK"],
    keywords: ["刺繡", "臂章", "布章", "patch"],
    fromSubcategories: ["charms", "tops-and-tshirts"],
    // Embroidered patches (and the 3D-embroidery / glow-in-the-dark patch
    // options) are worn badges. No bags-accessories or fashion L2 fits:
    // `charms` hang from a bag, `tops-and-tshirts` are garments. The least
    // wrong existing node is `brooches` (jewelry), which the ontology already
    // aliases to the zh word for badge, so the classifier routes badges there
    // too. Runner-up: `craft-kits-and-supplies` (stationery), if the owner
    // reads them as sew-on supplies. This moves the rows to another L1, which
    // the catalog-copy audit will list under the brand-L1 review section.
    toSubcategory: "brooches",
    reason: "embroidered patch is a worn badge, not a charm or a garment",
  },
];

/** The brand whose story still carries a full-width letter. */
export const FULL_WIDTH_BRAND_SLUG = "rmc";

// ---------------------------------------------------------------------------
// Planning (pure)
// ---------------------------------------------------------------------------

export type FixProductRow = {
  id: string;
  name_zh: string;
  category: string;
  subcategory: string | null;
  brands?: { slug: string } | { slug: string }[] | null;
};

export type FixBrandRow = { id: string; slug: string; description: string | null };

type Taxonomy = { category: string; subcategory: string | null };

export type ProductFix = {
  id: string;
  brandSlug: string;
  nameZh: string;
  before: Taxonomy;
  after: { category: string; subcategory: string };
  reason: string;
};

export type DescriptionFix = {
  id: string;
  slug: string;
  before: string;
  after: string;
};

export type TaxonomyPlan = {
  productFixes: ProductFix[];
  /** Matched rows already on the target L2. */
  alreadyFixed: { id: string; brandSlug: string; nameZh: string }[];
  /** `brand: name` for each exact name with no row, and each keyword rule that matched nothing. */
  notFound: string[];
  descriptionFix: DescriptionFix | null;
};

function brandSlugOf(row: FixProductRow): string | null {
  const brands = Array.isArray(row.brands) ? row.brands[0] : row.brands;
  return brands?.slug ?? null;
}

/** Full-width Latin letters and digits to half-width; nothing else changes. */
export function foldFullWidthAlnum(text: string): string {
  return text.replace(/[０-９Ａ-Ｚａ-ｚ]/gu, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0),
  );
}

function matchesRule(row: FixProductRow, rule: TaxonomyRule): boolean {
  const name = row.name_zh.trim();
  if (rule.exactNames.includes(name)) return true;
  if (!rule.fromSubcategories.includes(row.subcategory ?? "")) return false;
  const lower = name.toLowerCase();
  return rule.keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
}

export function planTaxonomyFixes(
  products: readonly FixProductRow[],
  brand: FixBrandRow | null,
  rules: readonly TaxonomyRule[] = TAXONOMY_RULES,
): TaxonomyPlan {
  const plan: TaxonomyPlan = {
    productFixes: [],
    alreadyFixed: [],
    notFound: [],
    descriptionFix: null,
  };

  for (const rule of rules) {
    const node = subcategoryBySlug(rule.toSubcategory);
    if (!node) throw new Error(`unknown target subcategory ${rule.toSubcategory}`);
    const brandRows = products.filter((row) => brandSlugOf(row) === rule.brandSlug);
    const matched = brandRows.filter((row) => matchesRule(row, rule));

    for (const name of rule.exactNames) {
      if (!brandRows.some((row) => row.name_zh.trim() === name)) {
        plan.notFound.push(`${rule.brandSlug}: ${name}`);
      }
    }
    if (rule.keywords.length > 0 && matched.length === 0) {
      plan.notFound.push(
        `${rule.brandSlug}: no row named with ${rule.keywords.join("/")} in ${rule.fromSubcategories.join("/")}`,
      );
    }

    for (const row of matched) {
      if (row.subcategory === node.slug && row.category === node.category) {
        plan.alreadyFixed.push({ id: row.id, brandSlug: rule.brandSlug, nameZh: row.name_zh });
        continue;
      }
      plan.productFixes.push({
        id: row.id,
        brandSlug: rule.brandSlug,
        nameZh: row.name_zh,
        before: { category: row.category, subcategory: row.subcategory },
        after: { category: node.category, subcategory: node.slug },
        reason: rule.reason,
      });
    }
  }

  if (brand?.description) {
    const after = foldFullWidthAlnum(brand.description);
    if (after !== brand.description) {
      plan.descriptionFix = {
        id: brand.id,
        slug: brand.slug,
        before: brand.description,
        after,
      };
    }
  } else if (!brand) {
    plan.notFound.push(`${FULL_WIDTH_BRAND_SLUG}: brand row`);
  }

  return plan;
}

/**
 * `loadScriptTarget` already defaults to staging; this makes the production
 * case explicit — it must have been named on the command line.
 */
export function assertAllowedTarget(target: ScriptTarget, rawArgv: readonly string[]): void {
  if (target === "staging") return;
  const named = rawArgv.some(
    (arg, index) =>
      arg === "--target=production" ||
      (arg === "--target" && rawArgv[index + 1] === "production"),
  );
  if (!named) throw new Error("production writes need an explicit --target=production");
}

/** Slugs whose public pages change when `plan` is applied. */
export function touchedBrandSlugs(plan: TaxonomyPlan): string[] {
  return [
    ...new Set([
      ...plan.productFixes.map((fix) => fix.brandSlug),
      ...(plan.descriptionFix ? [plan.descriptionFix.slug] : []),
    ]),
  ].sort();
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

const PAGE_SIZE = 500;

async function main(): Promise<void> {
  const rawArgv = process.argv.slice(2);
  const { loadScriptTarget } = await import("../../../shared/target");
  const { target, argv } = loadScriptTarget(rawArgv);
  assertAllowedTarget(target, rawArgv);
  const apply = parseApplyOption(argv);
  // Staging has no revalidation route (.env.staging carries no ORIGIN_SECRET).
  const revalidate = target === "production";
  if (apply && revalidate) assertRevalidationConfigured();

  const { createServiceClient } = await import("@/lib/supabase/service");
  const supabase = createServiceClient();
  const slugs = [...new Set(TAXONOMY_RULES.map((rule) => rule.brandSlug))];

  const products = await fetchAllRows<FixProductRow>(
    "curated_products",
    (from, to) =>
      supabase
        .from("curated_products")
        .select("id, name_zh, category, subcategory, brands!inner(slug)")
        .in("brands.slug", slugs)
        .order("id", { ascending: true })
        .range(from, to),
    PAGE_SIZE,
  );
  const { data: brand, error: brandError } = await supabase
    .from("brands")
    .select("id, slug, description")
    .eq("slug", FULL_WIDTH_BRAND_SLUG)
    .maybeSingle();
  if (brandError) throw new Error(`failed to read brand: ${brandError.message}`);

  const plan = planTaxonomyFixes(products, (brand as FixBrandRow | null) ?? null);

  // Before any write, so a run that dies mid-way still leaves its rollback.
  const rollbackPath = join(
    "scripts",
    "backup",
    `fix-bd2-26-taxonomy-${target}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  mkdirSync(join("scripts", "backup"), { recursive: true });
  writeFileSync(
    rollbackPath,
    `${JSON.stringify({ target, mode: apply ? "apply" : "dry-run", ...plan }, null, 2)}\n`,
  );

  console.log(
    JSON.stringify({
      target,
      mode: apply ? "apply" : "dry-run",
      productFixes: plan.productFixes.length,
      alreadyFixed: plan.alreadyFixed.length,
      descriptionFix: plan.descriptionFix !== null,
      notFound: plan.notFound.length,
      rollback: rollbackPath,
    }),
  );
  for (const fix of plan.productFixes) {
    console.log(
      `${fix.brandSlug} | ${fix.id} | ${fix.nameZh} | ${fix.before.category}/${fix.before.subcategory ?? "-"} → ${fix.after.category}/${fix.after.subcategory}`,
    );
  }
  for (const row of plan.alreadyFixed) {
    console.log(`already fixed: ${row.brandSlug} | ${row.id} | ${row.nameZh}`);
  }
  for (const missing of plan.notFound) console.log(`not found: ${missing}`);
  if (plan.descriptionFix) {
    console.log(`${plan.descriptionFix.slug} description: full-width letters/digits → half-width`);
  }

  if (!apply) {
    console.log("No changes made. Re-run with --apply to write.");
    return;
  }

  // Imported here so the test, which imports this module for its pure
  // functions, never loads the services.
  const { updateCuratedProduct } = await import("@/lib/services/curated-products");
  const { updateBrand } = await import("@/lib/services/brands");
  const failures: string[] = [];
  let written = 0;
  for (const fix of plan.productFixes) {
    try {
      await updateCuratedProduct(fix.id, fix.after);
      written += 1;
    } catch (error: unknown) {
      failures.push(`${fix.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (plan.descriptionFix) {
    try {
      await updateBrand(
        plan.descriptionFix.id,
        { description: plan.descriptionFix.after },
        { source: "admin" },
      );
      written += 1;
    } catch (error: unknown) {
      failures.push(
        `${plan.descriptionFix.slug}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  console.log(JSON.stringify({ written, failures }));
  if (failures.length > 0) process.exitCode = 1;
  if (written === 0) return;

  const touched = touchedBrandSlugs(plan);
  if (!revalidate) {
    console.log(
      JSON.stringify({
        revalidation: "skipped",
        reason:
          "staging has no revalidation route (no ORIGIN_SECRET / FORMORIA_RAILWAY_URL in .env.staging); pages refresh by ISR (1h) or a staging redeploy",
        slugs: touched,
      }),
    );
    return;
  }
  const { requestPublicBrandRevalidation } = await import("@/lib/cache/revalidate-client");
  const revalidation = await requestPublicBrandRevalidation(touched);
  console.log(
    JSON.stringify({ revalidated: touched, ok: revalidation.ok, reason: revalidation.reason ?? null }),
  );
  if (!revalidation.ok) {
    throw new Error(
      `revalidation failed (${revalidation.reason ?? "unknown"}): brand pages are stale`,
    );
  }
}

if (process.argv[1]?.endsWith("curated-products/fix-bd2-26-taxonomy.ts")) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
