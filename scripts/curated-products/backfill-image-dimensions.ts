import sharp from "sharp";

import { auditedCall } from "@/lib/audit";
import { mapWithConcurrency } from "@/lib/services/_shared/concurrency";
import { createServiceClient } from "@/lib/supabase/service";

import { assertRevalidationConfigured, fetchAllRows } from "./shared";

/**
 * Backfills `curated_products.image_width` / `image_height` (DEV-1479).
 *
 *   pnpm exec tsx --env-file=.env.local scripts/curated-products/backfill-image-dimensions.ts
 *   pnpm exec tsx --env-file=.env.local scripts/curated-products/backfill-image-dimensions.ts --apply
 *
 * MEASURED FROM THE STORED OBJECT, NEVER `image_source_url`. The stored bytes
 * are what a browser downloads and what the homepage wall renders at its native
 * ratio; they have already passed the write path's rotate and resize, so their
 * dimensions are the only ones the tile can be sized from. `image_source_url`
 * is additionally NULL on every fixture row today, so a source-based backfill
 * would measure nothing at all.
 *
 * NULL IS THE CURSOR. A row this run could not read stays NULL and is picked up
 * by the next run; the renderer falls back to 4:3 meanwhile. Writing a guessed
 * size would burn the cursor on a row nothing would ever revisit.
 *
 * ONE BAD ROW IS NOT A FAILED RUN. `mapWithConcurrency` awaits `Promise.all`,
 * so without a per-row catch a single deleted storage object aborts every
 * remaining row after an arbitrary prefix has already been written.
 *
 * WRITE SCOPE: the two dimension columns and nothing else. Every other column
 * on this table is authored, and a measurement pass that touched one would
 * overwrite editorial copy with whatever the read happened to see.
 */

const PAGE_SIZE = 500;
const CONCURRENCY = 4;

/**
 * A hard ceiling on the bytes one measurement may pull. The stored objects are
 * processor output (WebP, 1200px long edge), so anything near this cap is not
 * one of ours.
 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type DimensionRow = {
  id: string;
  key: string;
  image_url: string | null;
  image_source_url: string | null;
  image_width: number | null;
  image_height: number | null;
};

/**
 * The narrowest read shape this script needs, declared so the unit test can
 * inject a recording double instead of mocking the Supabase module — which
 * `scripts/check-test-boundaries.mjs` forbids.
 */
export type DimensionQuery = {
  is(column: string, value: unknown): DimensionQuery;
  not(column: string, operator: string, value: unknown): DimensionQuery;
  order(column: string, options: { ascending: boolean }): DimensionQuery;
  range(
    from: number,
    to: number,
  ): PromiseLike<{
    data: DimensionRow[] | null;
    error: { message: string } | null;
  }>;
};

export type DimensionReader = {
  from(table: string): { select(columns: string): DimensionQuery };
};

/** Same seam, for the write half. */
export type DimensionWriter = {
  from(table: string): {
    update(values: Record<string, unknown>): {
      eq(
        column: string,
        value: string,
      ): PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

export type Measurement = { width: number; height: number };

/** Injected by the test; the default reads the stored object over HTTP. */
export type MeasureImage = (
  imageUrl: string,
  rowId: string,
) => Promise<Measurement>;

/** Dry run is the default: `--apply` is the only thing that writes. */
export function parseApplyOption(argv: readonly string[]): boolean {
  return argv.includes("--apply");
}

/**
 * PAGED and resumable. `image_width is null` is the cursor, so a re-run picks
 * up exactly what the last one could not measure. A single unpaged `select()`
 * stops at Supabase's `db-max-rows` with no error at all.
 */
export async function loadRowsNeedingDimensions(
  force: boolean,
  client?: DimensionReader,
): Promise<DimensionRow[]> {
  // The generic PostgREST builder is structurally wider than DimensionReader;
  // this cast narrows it at the one call site rather than leaking generics.
  const supabase =
    client ?? (createServiceClient() as unknown as DimensionReader);
  return fetchAllRows<DimensionRow>(
    "curated_products",
    (from, to) => {
      let query = supabase
        .from("curated_products")
        .select("id, key, image_url, image_source_url, image_width, image_height")
        // Nothing to measure without a stored object.
        .not("image_url", "is", null);
      if (!force) query = query.is("image_width", null);
      // A stable order is what makes paging correct: without it two pages can
      // repeat one row and skip another.
      return query.order("id", { ascending: true }).range(from, to);
    },
    PAGE_SIZE,
  );
}

/**
 * Reads the stored object and asks sharp for its intrinsic size.
 *
 * PLAIN `fetch` ON THE PUBLIC URL, never Supabase Storage's
 * transformation endpoint: that endpoint is metered and took production down
 * once already (DEV-1374, and `scripts/check-storage-transforms.mjs` guards
 * it). Only the header bytes matter, but the object is small enough that a
 * whole-body read with a hard cap is simpler than a ranged one.
 */
export const measureStoredImage: MeasureImage = async (imageUrl, rowId) =>
  auditedCall(
    {
      provider: "http",
      operation: "measure_curated_image",
      kind: "external",
    },
    async () => {
      const response = await fetch(imageUrl, {
        headers: { Accept: "image/*" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} reading ${imageUrl}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > MAX_IMAGE_BYTES) {
        throw new Error(`stored object exceeds ${MAX_IMAGE_BYTES} bytes`);
      }
      const { width, height } = await sharp(buffer).metadata();
      if (!width || !height) {
        throw new Error("sharp could not read the object's dimensions");
      }
      return { width, height };
    },
    { subjectId: rowId },
  );

export type BackfillReport = {
  selected: number;
  /** Rows that already carried both dimensions, or carry no stored object. */
  skipped: number;
  measured: number;
  /** What a `--apply` run WOULD write; equals `written` once it does. */
  intended: number;
  written: number;
  failures: string[];
};

export type BackfillInput = {
  rows: readonly DimensionRow[];
  apply: boolean;
  writer: DimensionWriter;
  measure: MeasureImage;
  concurrency?: number;
};

export async function backfillImageDimensions({
  rows,
  apply,
  writer,
  measure,
  concurrency = CONCURRENCY,
}: BackfillInput): Promise<BackfillReport> {
  const report: BackfillReport = {
    selected: rows.length,
    skipped: 0,
    measured: 0,
    intended: 0,
    written: 0,
    failures: [],
  };

  const pending = rows.filter((row) => {
    const done = row.image_width !== null && row.image_height !== null;
    if (done || !row.image_url) {
      report.skipped += 1;
      return false;
    }
    return true;
  });

  await mapWithConcurrency(pending, concurrency, async (row) => {
    try {
      // `image_url` and nothing else: see the header. The non-null check above
      // is what makes this assertion safe.
      const { width, height } = await measure(row.image_url!, row.id);
      report.measured += 1;
      report.intended += 1;
      if (!apply) return;

      const { error } = await writer
        .from("curated_products")
        .update({ image_width: width, image_height: height })
        .eq("id", row.id);
      if (error) throw new Error(error.message);
      report.written += 1;
    } catch (error: unknown) {
      // Counted and carried, never thrown: one unreadable object must not end
      // a run that has already written an arbitrary prefix of the rest.
      report.failures.push(
        `${row.id} (${row.key}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });

  return report;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = parseApplyOption(argv);
  const force = argv.includes("--force");
  // Preflight BEFORE the first write: a write that lands while revalidation is
  // unconfigured leaves the homepage serving its hour-old shell.
  if (apply) assertRevalidationConfigured();

  const rows = await loadRowsNeedingDimensions(force);
  const report = await backfillImageDimensions({
    rows,
    apply,
    writer: createServiceClient() as unknown as DimensionWriter,
    measure: measureStoredImage,
  });

  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      ...report,
      failures: report.failures.length,
    }),
  );
  // Bounded sample: a full list would bury the summary an operator reads.
  for (const failure of report.failures.slice(0, 20)) {
    console.log(JSON.stringify({ skipped: failure }));
  }
  if (report.failures.length > 0) {
    console.log(
      `${report.failures.length} row(s) left NULL and retried by the next run; the wall renders them at 4:3 meanwhile.`,
    );
    // A run with unmeasured rows is not a complete run.
    process.exitCode = 1;
  }
  if (!apply) console.log("No changes made. Re-run with --apply to write.");
}

// The test imports the pure functions from this module, so importing it must
// never start a run. `main()` fires only when this file IS the process entry
// point — under vitest argv[1] is the runner, not this file.
if (process.argv[1]?.endsWith("curated-products/backfill-image-dimensions.ts")) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
