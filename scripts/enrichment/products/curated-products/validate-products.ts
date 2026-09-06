import * as fs from "node:fs";

import { createServiceClient } from "@/lib/supabase/service";
import { subcategoryBySlug } from "@/lib/taxonomy/ontology";

import { fetchAllRows, parseBrandOption, parseCsvPath } from "./shared";

/**
 * Curated-product end-state validator (DEV-1609).
 *
 *   pnpm exec tsx --env-file=.env.local scripts/curated-products/validate-products.ts
 *   pnpm exec tsx --env-file=.env.local scripts/curated-products/validate-products.ts --brand=hanchor
 *   pnpm exec tsx --env-file=.env.local scripts/curated-products/validate-products.ts --csv=path/to/sheet.csv
 *
 * READ-ONLY — no writes to the database.
 *
 * THREE CHECKS:
 *   1. Gate check — missing image_url, official_url, or source_checked_at
 *   2. Content lint — forbidden terms in product_description_zh
 *   3. CSV comparison — URL match rate against an exported spreadsheet
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Product = {
  id: string;
  key: string;
  brand_id: string;
  category: string;
  subcategory: string | null;
  product_description_zh: string | null;
  image_url: string | null;
  official_url: string | null;
  visible: boolean;
  brands?: { slug: string } | { slug: string }[] | null;
};

type Source = {
  curated_product_id: string;
  source_checked_at: string | null;
};

export type ValidateProductsDeps = {
  fetchProducts: (brandSlug?: string) => Promise<Product[]>;
  fetchSources: (productIds: string[]) => Promise<Source[]>;
};

export type ValidateProductsInput = {
  brandSlug: string | null;
  csvPath: string | null;
};

type GateFailure = {
  productId: string;
  key: string;
  brandSlug: string;
  field: "image_url" | "official_url" | "source_checked_at" | "subcategory";
};

type ForbiddenTermHit = {
  productId: string;
  key: string;
  brandSlug: string;
  term: string;
};

type CsvBrandMatch = {
  slug: string;
  matched: number;
  csvUrls: number;
  matchRate: number;
};

type CsvComparison = {
  perBrand: CsvBrandMatch[];
  overall: { matched: number; total: number; matchRate: number };
};

export type ValidateResult = {
  productCount: number;
  brandCount: number;
  gateFailures: GateFailure[];
  forbiddenTerms: ForbiddenTermHit[];
  csvComparison: CsvComparison | null;
  exitCode: number;
};

// ---------------------------------------------------------------------------
// Forbidden terms
// ---------------------------------------------------------------------------

const FORBIDDEN_TERMS = [
  "值得",
  "必買",
  "療癒",
  "質感絕佳",
  "獨特",
  "讓你",
  "適合喜歡",
  "你會發現",
  "高品質",
  "精心設計",
  "用心製作",
  "價格",
  "售價",
  "特價",
  "折扣",
  "庫存",
  "現貨",
  "缺貨",
  "運費",
  "到貨",
  "出貨",
  "規格選擇",
] as const;

// ---------------------------------------------------------------------------
// URL normalization
// ---------------------------------------------------------------------------

export function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return raw.trim().replace(/\/$/, "");
  }
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

function parseCsvForUrls(csvContent: string): Map<string, string[]> {
  const lines = csvContent.trim().split("\n");
  if (lines.length < 2) return new Map();

  const headers = lines[0].split(",").map((h) => h.trim());
  const slugCol = headers.indexOf("formoria_slug");
  if (slugCol === -1) return new Map();

  const urlCols = headers
    .map((h, i) => ({ header: h, index: i }))
    .filter((c) => /^product_\d+_url$/.test(c.header))
    .map((c) => c.index);

  const result = new Map<string, string[]>();

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const slug = cols[slugCol];
    if (!slug) continue;

    const urls = urlCols
      .map((ci) => cols[ci])
      .filter((u): u is string => Boolean(u));

    if (urls.length > 0) {
      const existing = result.get(slug) ?? [];
      existing.push(...urls);
      result.set(slug, existing);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveBrandSlug(product: Product): string {
  if (!product.brands) return "unknown";
  if (Array.isArray(product.brands)) {
    return product.brands[0]?.slug ?? "unknown";
  }
  return product.brands.slug;
}

// ---------------------------------------------------------------------------
// Core validator
// ---------------------------------------------------------------------------

export async function validateProducts(
  input: ValidateProductsInput,
  deps: ValidateProductsDeps,
  /** Injected CSV content for testing — when provided, csvPath is ignored. */
  csvContentOverride?: string,
): Promise<ValidateResult> {
  // 1. Fetch products
  const products = await deps.fetchProducts(input.brandSlug ?? undefined);

  const brandSlugs = new Set(products.map(resolveBrandSlug));

  // 2. Gate check
  const gateFailures: GateFailure[] = [];

  for (const p of products) {
    const slug = resolveBrandSlug(p);
    const subcategory = p.subcategory ? subcategoryBySlug(p.subcategory) : null;
    if (!subcategory || subcategory.category !== p.category) {
      gateFailures.push({
        productId: p.id,
        key: p.key,
        brandSlug: slug,
        field: "subcategory",
      });
    }
    if (p.image_url === null) {
      gateFailures.push({
        productId: p.id,
        key: p.key,
        brandSlug: slug,
        field: "image_url",
      });
    }
    if (p.official_url === null) {
      gateFailures.push({
        productId: p.id,
        key: p.key,
        brandSlug: slug,
        field: "official_url",
      });
    }
  }

  // Check source_checked_at
  const productIds = products.map((p) => p.id);
  if (productIds.length > 0) {
    const sources = await deps.fetchSources(productIds);
    const sourceMap = new Map(sources.map((s) => [s.curated_product_id, s]));

    for (const p of products) {
      const source = sourceMap.get(p.id);
      if (!source || source.source_checked_at === null) {
        const slug = resolveBrandSlug(p);
        gateFailures.push({
          productId: p.id,
          key: p.key,
          brandSlug: slug,
          field: "source_checked_at",
        });
      }
    }
  }

  // 3. Content lint — forbidden terms
  const forbiddenTerms: ForbiddenTermHit[] = [];

  for (const p of products) {
    if (!p.product_description_zh) continue;
    const slug = resolveBrandSlug(p);
    for (const term of FORBIDDEN_TERMS) {
      if (p.product_description_zh.includes(term)) {
        forbiddenTerms.push({
          productId: p.id,
          key: p.key,
          brandSlug: slug,
          term,
        });
      }
    }
  }

  // 4. CSV comparison
  let csvComparison: CsvComparison | null = null;

  if (input.csvPath) {
    const csvContent =
      csvContentOverride ?? fs.readFileSync(input.csvPath, "utf-8");
    const csvByBrand = parseCsvForUrls(csvContent);

    // Build normalized URL set from DB products, grouped by brand slug
    const dbUrlsByBrand = new Map<string, Set<string>>();
    for (const p of products) {
      if (!p.official_url) continue;
      const slug = resolveBrandSlug(p);
      if (!dbUrlsByBrand.has(slug)) dbUrlsByBrand.set(slug, new Set());
      dbUrlsByBrand.get(slug)!.add(normalizeUrl(p.official_url));
    }

    const perBrand: CsvBrandMatch[] = [];
    let totalMatched = 0;
    let totalCsvUrls = 0;

    for (const [slug, csvUrls] of csvByBrand) {
      const dbUrls = dbUrlsByBrand.get(slug) ?? new Set<string>();
      let matched = 0;

      for (const csvUrl of csvUrls) {
        if (dbUrls.has(normalizeUrl(csvUrl))) {
          matched++;
        }
      }

      perBrand.push({
        slug,
        matched,
        csvUrls: csvUrls.length,
        matchRate: csvUrls.length > 0 ? matched / csvUrls.length : 0,
      });

      totalMatched += matched;
      totalCsvUrls += csvUrls.length;
    }

    csvComparison = {
      perBrand,
      overall: {
        matched: totalMatched,
        total: totalCsvUrls,
        matchRate: totalCsvUrls > 0 ? totalMatched / totalCsvUrls : 0,
      },
    };
  }

  // 5. Report
  const hasIssues = gateFailures.length > 0 || forbiddenTerms.length > 0;
  const hasCsvIssues =
    csvComparison !== null && csvComparison.overall.matchRate < 0.5;

  return {
    productCount: products.length,
    brandCount: brandSlugs.size,
    gateFailures,
    forbiddenTerms,
    csvComparison,
    exitCode: hasIssues || hasCsvIssues ? 1 : 0,
  };
}

// ---------------------------------------------------------------------------
// Real deps (Supabase)
// ---------------------------------------------------------------------------

function createRealDeps(): ValidateProductsDeps {
  const supabase = createServiceClient();

  return {
    fetchProducts: async (brandSlug) => {
      return fetchAllRows<Product>("curated_products", (from, to) => {
        const q = supabase
          .from("curated_products")
          .select(
            "id, key, brand_id, category, subcategory, product_description_zh, image_url, official_url, visible, brands!inner(slug)",
          )
          .eq("visible", true)
          .order("key")
          .range(from, to);
        return brandSlug ? q.eq("brands.slug", brandSlug) : q;
      });
    },

    fetchSources: async (productIds) => {
      return fetchAllRows<Source>("curated_product_sources", (from, to) =>
        supabase
          .from("curated_product_sources")
          .select("curated_product_id, source_checked_at")
          .in("curated_product_id", productIds)
          .order("curated_product_id")
          .range(from, to),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const brandSlug = parseBrandOption(argv);
  const csvPath = parseCsvPath(argv);

  const deps = createRealDeps();
  const result = await validateProducts({ brandSlug, csvPath }, deps);

  // Print report
  console.log(`\n=== Curated Product Validation ===`);
  console.log(
    `Products: ${result.productCount} across ${result.brandCount} brands`,
  );

  if (result.gateFailures.length > 0) {
    console.log(`\n--- Gate Failures (${result.gateFailures.length}) ---`);
    for (const f of result.gateFailures) {
      console.log(`  [${f.brandSlug}] ${f.key}: missing ${f.field}`);
    }
  }

  if (result.forbiddenTerms.length > 0) {
    console.log(`\n--- Forbidden Terms (${result.forbiddenTerms.length}) ---`);
    for (const f of result.forbiddenTerms) {
      console.log(`  [${f.brandSlug}] ${f.key}: "${f.term}"`);
    }
  }

  if (result.csvComparison) {
    const csv = result.csvComparison;
    console.log(`\n--- CSV Comparison ---`);
    for (const b of csv.perBrand) {
      console.log(
        `  ${b.slug}: ${b.matched}/${b.csvUrls} matched (${(b.matchRate * 100).toFixed(1)}%)`,
      );
    }
    console.log(
      `  Overall: ${csv.overall.matched}/${csv.overall.total} (${(csv.overall.matchRate * 100).toFixed(1)}%)`,
    );
  }

  if (result.exitCode === 0) {
    console.log(`\nAll checks passed.`);
  }

  process.exitCode = result.exitCode;
}

// The test imports the pure functions from this module, so importing it must
// never start a run. `main()` fires only when this file IS the process entry
// point — under vitest argv[1] is the runner, not this file.
if (process.argv[1]?.endsWith("curated-products/validate-products.ts")) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
