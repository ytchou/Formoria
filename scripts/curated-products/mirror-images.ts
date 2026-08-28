import { requestPublicBrandRevalidation } from "@/lib/cache/revalidate-client";
import { storeCuratedProductImage } from "@/lib/services/curated-product-image";
import { mapWithConcurrency } from "@/lib/services/_shared/concurrency";
import { createServiceClient } from "@/lib/supabase/service";

import {
  assertRevalidationConfigured,
  fetchAllRows,
  parseApplyOption,
} from "./shared";

/**
 * Mirrors curated-product images from their source URL into Supabase Storage
 * (DEV-1609).
 *
 *   pnpm exec tsx --env-file=.env.local scripts/curated-products/mirror-images.ts
 *   pnpm exec tsx --env-file=.env.local scripts/curated-products/mirror-images.ts --apply
 *
 * Finds visible products that have `image_source_url` but no `image_url`,
 * downloads and stores each image via `storeCuratedProductImage`, then updates
 * the row with the stored URL and dimensions.
 *
 * WRITE SCOPE: `image_url`, `image_width`, `image_height` — nothing else.
 *
 * ONE BAD ROW IS NOT A FAILED RUN. Per-row errors are caught and carried so
 * the remaining rows still process.
 */

const PAGE_SIZE = 500;
const CONCURRENCY = 2;

export type MirrorImageRow = {
  id: string;
  key: string;
  brand_id: string;
  image_source_url: string;
  image_url: string | null;
  brands?: { slug: string } | { slug: string }[] | null;
};

/** PostgREST returns a to-one embed as an object here and an array elsewhere. */
function brandSlugOf(row: MirrorImageRow): string | null {
  const brands = Array.isArray(row.brands) ? row.brands[0] : row.brands;
  return brands?.slug ?? null;
}

export type MirrorImagesDeps = {
  fetchRows: () => Promise<MirrorImageRow[]>;
  storeImage: (input: {
    brandId: string;
    productId: string;
    imageSourceUrl: string;
  }) => Promise<{ url: string; width: number; height: number }>;
  updateRow: (
    id: string,
    values: { image_url: string; image_width: number; image_height: number },
  ) => Promise<{ error: { message: string } | null }>;
  revalidate: (slug: string) => Promise<void>;
};

export type MirrorReport = {
  selected: number;
  skipped: number;
  stored: number;
  written: number;
  writtenBrandSlugs: string[];
  failures: string[];
};

export async function mirrorImages({
  apply,
  deps,
}: {
  apply: boolean;
  deps: MirrorImagesDeps;
}): Promise<MirrorReport> {
  const report: MirrorReport = {
    selected: 0,
    skipped: 0,
    stored: 0,
    written: 0,
    writtenBrandSlugs: [],
    failures: [],
  };

  const rows = await deps.fetchRows();
  report.selected = rows.length;

  const writtenBrandSlugs = new Set<string>();

  await mapWithConcurrency(rows, CONCURRENCY, async (row) => {
    try {
      if (!apply) {
        report.skipped += 1;
        return;
      }

      const result = await deps.storeImage({
        brandId: row.brand_id,
        productId: row.id,
        imageSourceUrl: row.image_source_url,
      });
      report.stored += 1;

      const { error } = await deps.updateRow(row.id, {
        image_url: result.url,
        image_width: result.width,
        image_height: result.height,
      });
      if (error) throw new Error(error.message);

      report.written += 1;
      const slug = brandSlugOf(row);
      if (slug) writtenBrandSlugs.add(slug);
    } catch (error: unknown) {
      report.failures.push(
        `${row.id} (${row.key}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });

  report.writtenBrandSlugs = [...writtenBrandSlugs].sort();

  // Revalidate affected brands after all writes complete.
  if (apply && writtenBrandSlugs.size > 0) {
    for (const slug of writtenBrandSlugs) {
      await deps.revalidate(slug);
    }
  }

  return report;
}

/** Default deps wired to real services. */
function realDeps(): MirrorImagesDeps {
  const supabase = createServiceClient();
  return {
    fetchRows: () =>
      fetchAllRows<MirrorImageRow>(
        "curated_products",
        (from, to) =>
          supabase
            .from("curated_products")
            .select(
              "id, key, brand_id, image_source_url, image_url, brands!inner(slug)",
            )
            .eq("visible", true)
            .not("image_source_url", "is", null)
            .is("image_url", null)
            .order("id", { ascending: true })
            .range(from, to),
        PAGE_SIZE,
      ),
    storeImage: (input) =>
      storeCuratedProductImage({
        brandId: input.brandId,
        productId: input.productId,
        imageSourceUrl: input.imageSourceUrl,
      }),
    updateRow: async (id, values) => {
      const { error } = await supabase
        .from("curated_products")
        .update(values)
        .eq("id", id);
      return { error };
    },
    revalidate: async (slug) => {
      await requestPublicBrandRevalidation([slug]);
    },
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = parseApplyOption(argv);
  if (apply) assertRevalidationConfigured();

  const deps = realDeps();
  const report = await mirrorImages({ apply, deps });

  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      ...report,
      writtenBrandSlugs: report.writtenBrandSlugs.length,
      failures: report.failures.length,
    }),
  );
  for (const failure of report.failures.slice(0, 20)) {
    console.log(JSON.stringify({ skipped: failure }));
  }
  if (report.failures.length > 0) {
    console.log(
      `${report.failures.length} row(s) failed; the next run will retry them.`,
    );
    process.exitCode = 1;
  }
  if (!apply) {
    console.log("No changes made. Re-run with --apply to write.");
  }
}

if (process.argv[1]?.endsWith("curated-products/mirror-images.ts")) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
