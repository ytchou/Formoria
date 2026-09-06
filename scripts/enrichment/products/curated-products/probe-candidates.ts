import * as fs from "node:fs";

import { createServiceClient } from "@/lib/supabase/service";
import {
  normalizeProductUrl,
  classifyProductUrl,
  dedupeNearDuplicates,
  type ProductCandidate,
} from "@/lib/services/enrich-phases/product-candidates";
// The probe reads brand_images provenance (provider_metadata.pageUrl) directly.
// A local ProbeClient type states the exact query chains.

import { fetchAllRows, parseSlugsOption, parseCsvPath } from "./shared";

/**
 * Read-only candidate probe (DEV-1610, Task 9).
 *
 *   pnpm exec tsx --env-file=.env.local scripts/curated-products/probe-candidates.ts \
 *     --slugs singbee,1973-furniture,simply-made --csv path/to/research.csv
 *
 * READ-ONLY — never enqueues a job, never calls an LLM, never writes.
 *
 * Reports per brand: stored-row count, classification split, dedupe reduction,
 * and CSV match rate. Flags any brand below the target of 3 product-detail
 * candidates.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BrandImageRow = {
  id: string;
  source_url: string | null;
  provider_metadata: unknown;
};

export type ProbeCandidatesDeps = {
  fetchBrandIds: (
    slugs: string[],
  ) => Promise<Array<{ slug: string; id: string }>>;
  fetchBrandImages: (brandId: string) => Promise<BrandImageRow[]>;
};

export type ProbeCandidatesInput = {
  slugs: string[];
  csvPath: string | null;
};

type BrandProbe = {
  slug: string;
  storedRowCount: number;
  productDetailCount: number;
  listingCount: number;
  otherCount: number;
  dedupeReduction: number;
  afterDedupeProductDetailCount: number;
  belowTarget: boolean;
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

export type ProbeResult = {
  totalRowsScanned: number;
  brands: BrandProbe[];
  csvComparison: CsvComparison | null;
  exitCode: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TARGET_PRODUCT_DETAIL = 3;

// ---------------------------------------------------------------------------
// Provider metadata extraction
// ---------------------------------------------------------------------------

/**
 * Reads `provider_metadata` defensively — it is untyped JSON in the DB.
 * Reads `provider_metadata` provenance from brand_images rows.
 */
function extractPageUrl(
  metadata: unknown,
): { pageUrl: string; title?: string; position?: number } | null {
  if (!metadata || typeof metadata !== "object") return null;
  const obj = metadata as Record<string, unknown>;

  const pageUrl = obj.pageUrl;
  if (typeof pageUrl !== "string" || !pageUrl) return null;

  return {
    pageUrl,
    title: typeof obj.title === "string" ? obj.title : undefined,
    position: typeof obj.position === "number" ? obj.position : undefined,
  };
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
// Core probe
// ---------------------------------------------------------------------------

export async function probeCandidates(
  input: ProbeCandidatesInput,
  deps: ProbeCandidatesDeps,
  /** Injected CSV content for testing — when provided, csvPath is ignored. */
  csvContentOverride?: string,
): Promise<ProbeResult> {
  const brandMap = await deps.fetchBrandIds(input.slugs);
  const brands: BrandProbe[] = [];
  let totalRowsScanned = 0;

  // Normalized pool URLs per brand slug (for CSV comparison)
  const poolUrlsByBrand = new Map<string, Set<string>>();

  for (const { slug, id } of brandMap) {
    const images = await deps.fetchBrandImages(id);
    totalRowsScanned += images.length;

    // Build candidates from provider_metadata, reusing Task 6 transforms
    const candidates: ProductCandidate[] = [];
    const normalizedUrls = new Set<string>();

    for (const row of images) {
      const fields = extractPageUrl(row.provider_metadata);
      if (!fields) continue;

      const normalizedUrl = normalizeProductUrl(fields.pageUrl);
      if (!normalizedUrl) continue;

      normalizedUrls.add(normalizedUrl);
      candidates.push({
        url: fields.pageUrl,
        normalizedUrl,
        title: fields.title,
        imageUrl: row.source_url ?? undefined,
        supplier: "stored",
        urlClass: classifyProductUrl(fields.pageUrl),
        searchPosition: fields.position,
      });
    }

    poolUrlsByBrand.set(slug, normalizedUrls);

    // Classification split (before dedupe)
    const productDetailCount = candidates.filter(
      (c) => c.urlClass === "product-detail",
    ).length;
    const listingCount = candidates.filter(
      (c) => c.urlClass === "listing",
    ).length;
    const otherCount = candidates.filter(
      (c) => c.urlClass === "other",
    ).length;

    // Dedupe using Task 6 near-duplicate collapse
    const { kept: deduped, collapsedCount } = dedupeNearDuplicates(candidates);
    const dedupeReduction = collapsedCount;
    const afterDedupeProductDetailCount = deduped.filter(
      (c) => c.urlClass === "product-detail",
    ).length;

    brands.push({
      slug,
      storedRowCount: images.length,
      productDetailCount,
      listingCount,
      otherCount,
      dedupeReduction,
      afterDedupeProductDetailCount,
      belowTarget: afterDedupeProductDetailCount < TARGET_PRODUCT_DETAIL,
    });
  }

  // CSV comparison — uses normalizeProductUrl so tracking params are stripped
  let csvComparison: CsvComparison | null = null;

  if (input.csvPath) {
    const csvContent =
      csvContentOverride ?? fs.readFileSync(input.csvPath, "utf-8");
    const csvByBrand = parseCsvForUrls(csvContent);

    const perBrand: CsvBrandMatch[] = [];
    let totalMatched = 0;
    let totalCsvUrls = 0;

    for (const [slug, csvUrls] of csvByBrand) {
      const poolUrls = poolUrlsByBrand.get(slug) ?? new Set<string>();
      let matched = 0;

      for (const csvUrl of csvUrls) {
        const normalized = normalizeProductUrl(csvUrl);
        if (normalized && poolUrls.has(normalized)) {
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

  const hasShortfall = brands.some((b) => b.belowTarget);

  return {
    totalRowsScanned,
    brands,
    csvComparison,
    exitCode: hasShortfall ? 1 : 0,
  };
}

// ---------------------------------------------------------------------------
// Real deps (Supabase) — paged reads only
// ---------------------------------------------------------------------------

/** Minimal PostgREST chain: select -> filter(s) -> order -> range. */
type PagedQuery<T> = {
  order(column: string): {
    range(
      from: number,
      to: number,
    ): PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
  };
};

type FilterableQuery<T> = PagedQuery<T> & {
  eq(column: string, value: unknown): FilterableQuery<T>;
  in(column: string, values: unknown[]): PagedQuery<T>;
};

/** The exact client surface the probe's paged reads need. */
type ProbeClient = {
  from(table: "brands"): { select(columns: string): FilterableQuery<{ slug: string; id: string }> };
  from(table: "brand_images"): { select(columns: string): FilterableQuery<BrandImageRow> };
};

function createRealDeps(): ProbeCandidatesDeps {
  const supabase = createServiceClient() as unknown as ProbeClient;

  return {
    fetchBrandIds: async (slugs) => {
      return fetchAllRows<{ slug: string; id: string }>(
        "brands",
        (from, to) =>
          supabase
            .from("brands")
            .select("slug, id")
            .in("slug", slugs)
            .order("slug")
            .range(from, to),
      );
    },

    fetchBrandImages: async (brandId) => {
      return fetchAllRows<BrandImageRow>("brand_images", (from, to) =>
        supabase
          .from("brand_images")
          .select("id, source_url, provider_metadata")
          .eq("brand_id", brandId)
          .eq("status", "active")
          .order("id")
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
  const slugs = parseSlugsOption(argv);
  const csvPath = parseCsvPath(argv);

  if (!slugs || slugs.length === 0) {
    console.error("--slugs is required (comma-separated brand slugs)");
    process.exitCode = 1;
    return;
  }

  const deps = createRealDeps();
  const result = await probeCandidates({ slugs, csvPath }, deps);

  // Print report
  console.log(`\n=== Candidate Probe ===`);
  console.log(`Total rows scanned: ${result.totalRowsScanned}`);
  console.log(`Brands: ${result.brands.length}`);

  for (const b of result.brands) {
    const flag = b.belowTarget ? " [BELOW TARGET]" : "";
    console.log(`\n--- ${b.slug}${flag} ---`);
    console.log(`  Stored rows:     ${b.storedRowCount}`);
    console.log(`  product-detail:  ${b.productDetailCount}`);
    console.log(`  listing:         ${b.listingCount}`);
    console.log(`  other:           ${b.otherCount}`);
    console.log(`  Dedupe reduction: ${b.dedupeReduction}`);
    console.log(
      `  After dedupe (product-detail): ${b.afterDedupeProductDetailCount}`,
    );
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
    console.log(`\nAll brands meet the target of ${TARGET_PRODUCT_DETAIL} product-detail candidates.`);
  }

  process.exitCode = result.exitCode;
}

// Guard: only fire main() when this file IS the process entry point.
if (process.argv[1]?.endsWith("curated-products/probe-candidates.ts")) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
