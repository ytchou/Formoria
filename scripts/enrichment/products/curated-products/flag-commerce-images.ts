import { requestPublicBrandRevalidation } from "@/lib/cache/revalidate-client";
import { findCommerceTruthText } from "@/lib/curated-products/commerce-text";
import { mapWithConcurrency } from "@/lib/services/_shared/concurrency";
import { updateCuratedProduct } from "@/lib/services/curated-products";
import { loadVisionDataUri } from "@/lib/services/enrich-phases/classify-images";
import { readImageTextFromDataUri } from "@/lib/services/image-text";
import { curatedProductStorageKeyFromPublicUrl } from "@/lib/services/image-upload";
import { createServiceClient } from "@/lib/supabase/service";

import {
  assertRevalidationConfigured,
  fetchAllRows,
  parseApplyOption,
  parseBrandOption,
} from "./shared";

/**
 * Flags stored curated-product images whose visible text shows prices or
 * promotions (DEV-1962).
 *
 * WRITTEN FOR DEV-1962 AND NOT EXECUTED AS PART OF ITS PR. Run it against
 * staging first, read the dry-run list, then production.
 *
 *   pnpm exec tsx --env-file=.env.local scripts/enrichment/products/curated-products/flag-commerce-images.ts
 *   …--brand=<slug>   scope the run to one brand (e.g. the LAB52 brand)
 *   …--apply          clear the flagged rows' stored image
 *
 * The ingest gate in `prepareCuratedProductImage` stops NEW promo images; this
 * finds the ones stored before it existed. Each stored object is read from
 * Storage and its text transcribed by one vision call (`readImageText`), then
 * matched with `findCommerceTruthText` — the same two functions the gate runs,
 * so the script and the gate cannot disagree about what a promo image is.
 *
 * WRITE SCOPE on `--apply`: `image_url`, `image_width`, `image_height` → NULL
 * on the flagged rows, through the service `updateCuratedProduct`.
 * `image_source_url` is KEPT, so the provenance survives; a later refresh
 * re-mirror of that source runs the ingest gate again and is rejected there.
 * An imageless row is hidden by the renderable-image gate on every surface.
 *
 * Shortcuts, with their ceilings:
 *   - The clear is keyed on the id alone (`updateCuratedProduct` takes no
 *     image_url guard). An editor who replaces the image between this run's
 *     read and its write loses the replacement; re-saving restores it. Upgrade
 *     path if runs grow long: key the write on the image_url that was read.
 *   - The cleared object stays in Storage, untracked, until the storage sweep
 *     reclaims it. Fine for a handful of rows; a large `--apply` should be
 *     reconciled against the sweep's `expectedUntracked` before its next run.
 *
 * ONE BAD ROW IS NOT A FAILED RUN: an unreadable image or a failed write is
 * counted and carried, never thrown, and never cleared — the gate fails closed,
 * this script fails open, because clearing an image nobody read would destroy
 * a clean photo on a transient error.
 */

const PAGE_SIZE = 500;
/** One vision call per row: kept low so a run does not burst the rate limit. */
const CONCURRENCY = 4;

export type FlagRow = {
  id: string;
  key: string;
  name_zh: string;
  image_url: string | null;
  /** PostgREST returns a to-one embed as an object here and an array elsewhere. */
  brands?: { slug: string } | { slug: string }[] | null;
};

function brandSlugOf(row: FlagRow): string | null {
  const brands = Array.isArray(row.brands) ? row.brands[0] : row.brands;
  return brands?.slug ?? null;
}

/**
 * The narrowest read shape this script needs, declared so the unit test can
 * inject a recording double instead of mocking the Supabase module — which
 * `scripts/check-test-boundaries.mjs` forbids.
 */
export type FlagQuery = {
  eq(column: string, value: unknown): FlagQuery;
  not(column: string, operator: string, value: unknown): FlagQuery;
  order(column: string, options: { ascending: boolean }): FlagQuery;
  range(
    from: number,
    to: number,
  ): PromiseLike<{ data: FlagRow[] | null; error: { message: string } | null }>;
};

export type FlagReader = {
  from(table: string): { select(columns: string): FlagQuery };
};

/** Reads one stored image's visible text. Injected by the test. */
export type ReadStoredImageText = (
  imageUrl: string,
  rowId: string,
) => Promise<string>;

/** Clears one row's stored image. Injected by the test. */
export type ClearImage = (rowId: string) => Promise<void>;

/**
 * PAGED, in a stable order: a single unpaged `select()` stops at Supabase's
 * `db-max-rows` with no error, and paging without an order can repeat one row
 * and skip another.
 */
export async function loadFlagCandidates(
  brandSlug: string | null,
  client?: FlagReader,
): Promise<FlagRow[]> {
  // The generic PostgREST builder is structurally wider than FlagReader; this
  // cast narrows it at the one call site rather than leaking generics.
  const supabase = client ?? (createServiceClient() as unknown as FlagReader);
  return fetchAllRows<FlagRow>(
    "curated_products",
    (from, to) => {
      let query = supabase
        .from("curated_products")
        .select("id, key, name_zh, image_url, brands!inner(slug)")
        .eq("visible", true)
        // Nothing to read without a stored object.
        .not("image_url", "is", null);
      if (brandSlug) query = query.eq("brands.slug", brandSlug);
      return query.order("id", { ascending: true }).range(from, to);
    },
    PAGE_SIZE,
  );
}

/**
 * Reads the STORED object, never `image_source_url`: the stored bytes are what
 * the site shows. The row's `/i/curated-products/…` url (or its legacy public
 * storage form) resolves to a bucket key, which `loadVisionDataUri` downloads
 * through the service client and encodes exactly as the classifier does.
 */
export const readStoredImageText: ReadStoredImageText = async (
  imageUrl,
  rowId,
) => {
  const key = curatedProductStorageKeyFromPublicUrl(imageUrl);
  if (!key) throw new Error(`not a curated-product storage url: ${imageUrl}`);
  const dataUri = await loadVisionDataUri({ storage_path: key });
  if (!dataUri) throw new Error(`could not load ${key} from storage`);
  return readImageTextFromDataUri(dataUri, { subjectId: rowId });
};

export const clearStoredImage: ClearImage = (rowId) =>
  updateCuratedProduct(rowId, {
    imageUrl: null,
    imageWidth: null,
    imageHeight: null,
  });

export type FlaggedImage = {
  brandSlug: string | null;
  id: string;
  name: string;
  hits: string[];
};

export type FlagReport = {
  selected: number;
  /** Rows with no stored image. */
  skipped: number;
  /** Rows whose image text was read. */
  scanned: number;
  flagged: FlaggedImage[];
  cleared: number;
  /** Brand slugs whose rows were actually cleared, for revalidation. */
  clearedBrandSlugs: string[];
  failures: string[];
};

export type FlagInput = {
  rows: readonly FlagRow[];
  apply: boolean;
  readText: ReadStoredImageText;
  clearImage: ClearImage;
  concurrency?: number;
};

export async function flagCommerceImages({
  rows,
  apply,
  readText,
  clearImage,
  concurrency = CONCURRENCY,
}: FlagInput): Promise<FlagReport> {
  const report: FlagReport = {
    selected: rows.length,
    skipped: 0,
    scanned: 0,
    flagged: [],
    cleared: 0,
    clearedBrandSlugs: [],
    failures: [],
  };
  const flaggedById = new Map<string, FlaggedImage>();
  const clearedBrandSlugs = new Set<string>();

  const pending = rows.filter((row) => {
    if (row.image_url) return true;
    report.skipped += 1;
    return false;
  });

  await mapWithConcurrency(pending, concurrency, async (row) => {
    let hits: string[];
    try {
      // The filter above is what makes this assertion safe.
      hits = findCommerceTruthText(await readText(row.image_url!, row.id));
      report.scanned += 1;
    } catch (error: unknown) {
      report.failures.push(
        `${row.id} (${row.key}): read: ${errorMessage(error)}`,
      );
      return;
    }
    if (hits.length === 0) return;

    flaggedById.set(row.id, {
      brandSlug: brandSlugOf(row),
      id: row.id,
      name: row.name_zh,
      hits,
    });
    if (!apply) return;

    try {
      await clearImage(row.id);
      report.cleared += 1;
      const brandSlug = brandSlugOf(row);
      if (brandSlug) clearedBrandSlugs.add(brandSlug);
    } catch (error: unknown) {
      report.failures.push(
        `${row.id} (${row.key}): clear: ${errorMessage(error)}`,
      );
    }
  });

  // Input order, not completion order, so two runs print the same list.
  report.flagged = pending
    .map((row) => flaggedById.get(row.id))
    .filter((entry): entry is FlaggedImage => entry !== undefined);
  report.clearedBrandSlugs = [...clearedBrandSlugs].sort();
  return report;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = parseApplyOption(argv);
  const brandSlug = parseBrandOption(argv);
  // Preflight BEFORE the first write: a clear that lands while revalidation is
  // unconfigured leaves the promo image on the cached pages for up to an hour.
  if (apply) assertRevalidationConfigured();

  const rows = await loadFlagCandidates(brandSlug);
  const report = await flagCommerceImages({
    rows,
    apply,
    readText: readStoredImageText,
    clearImage: clearStoredImage,
  });

  for (const entry of report.flagged) {
    console.log(
      [entry.brandSlug ?? "-", entry.id, entry.name, entry.hits.join(" ")].join(
        " | ",
      ),
    );
  }
  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      brand: brandSlug,
      selected: report.selected,
      skipped: report.skipped,
      scanned: report.scanned,
      flagged: report.flagged.length,
      cleared: report.cleared,
      clearedBrandSlugs: report.clearedBrandSlugs.length,
      failures: report.failures.length,
    }),
  );
  // Bounded sample: a full list would bury the summary an operator reads.
  for (const failure of report.failures.slice(0, 20)) {
    console.log(JSON.stringify({ failed: failure }));
  }
  // A run that could not read every image is not a complete run.
  if (report.failures.length > 0) process.exitCode = 1;

  if (!apply) {
    console.log(
      "No changes made. Re-run with --apply to clear the flagged images.",
    );
    return;
  }
  if (report.cleared === 0) return;

  const revalidation = await requestPublicBrandRevalidation(
    report.clearedBrandSlugs,
  );
  console.log(
    JSON.stringify({
      revalidated: report.clearedBrandSlugs.length,
      ok: revalidation.ok,
      reason: revalidation.reason ?? null,
    }),
  );
  if (!revalidation.ok) {
    // The clears are committed; a run whose pages still show the promo image
    // must not exit 0.
    throw new Error(
      `revalidation failed (${revalidation.reason ?? "unknown"}): pages are stale`,
    );
  }
}

// The test imports the pure functions from this module, so importing it must
// never start a run. `main()` fires only when this file IS the process entry
// point — under vitest argv[1] is the runner, not this file.
if (process.argv[1]?.endsWith("curated-products/flag-commerce-images.ts")) {
  void main().catch((error: unknown) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}
