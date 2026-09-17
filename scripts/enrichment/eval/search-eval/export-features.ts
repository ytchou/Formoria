/**
 * Export feature rows for LTR training.
 * Helper for the export-features subcommand in retrieval-eval.ts.
 */
import { resolve, dirname } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

import {
  buildFeatureRows,
  fetchDocFeatures,
  featureSpecHash,
  FEATURE_NAMES,
  type RpcRow,
  type DocFeatures,
} from "@/lib/services/ltr-features";
import {
  searchProductsBySituation,
  createDefaultSearchDeps,
  type SearchDeps,
} from "@/lib/services/product-situation-search";
import { loadDatasetV2 } from "./dataset-v2";
import { compositeKey } from "@/lib/services/eval/retrieval-adapter";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname);
const RUNS_DIR = resolve(SCRIPT_DIR, "runs");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExportRow = {
  qid: string;
  brandSlug: string;
  productKey: string;
  grade: number;
  features: Float32Array;
};

// ---------------------------------------------------------------------------
// buildExportRows
// ---------------------------------------------------------------------------

/**
 * Join RPC rows to hydrated products by product_id (not index), build feature
 * vectors, and attach grades from the dataset.  Unjudged pairs default to 0.
 *
 * Throws when a graded pair from the dataset is absent from the retrieval pool.
 */
export function buildExportRows(
  qid: string,
  rpcRows: RpcRow[],
  docs: Map<string, DocFeatures>,
  productMap: Map<string, { brandSlug: string; key: string }>,
  grades: Map<string, number>,
  query: string,
): ExportRow[] {
  // Filter rpc rows to those with hydrated products (join by product_id)
  const surviving: Array<{
    rpc: RpcRow;
    product: { brandSlug: string; key: string };
  }> = [];
  for (const rpc of rpcRows) {
    const product = productMap.get(rpc.product_id);
    if (product) {
      surviving.push({ rpc, product });
    }
  }

  // Build features only for surviving rows
  const survivingRpcRows = surviving.map((s) => s.rpc);
  const feats = buildFeatureRows(query, survivingRpcRows, docs);

  // Collect composite keys in the pool
  const poolKeys = new Set<string>();
  const rows: ExportRow[] = [];

  for (let i = 0; i < surviving.length; i++) {
    const { product } = surviving[i]!;
    const ck = compositeKey(product);
    poolKeys.add(ck);
    const grade = grades.get(ck) ?? 0;
    rows.push({
      qid,
      brandSlug: product.brandSlug,
      productKey: product.key,
      grade,
      features: feats[i]!,
    });
  }

  // Warn when a graded pair is absent from the pool (pool drift)
  for (const key of grades.keys()) {
    if (!poolKeys.has(key)) {
      console.warn(
        `[export-features] WARN: graded pair "${key}" for query "${qid}" absent from pool (drift), skipping`,
      );
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// sortByScores — pure ranking helper for testability
// ---------------------------------------------------------------------------

/**
 * Given products aligned with scores, return composite keys sorted by score
 * descending.  Products must already be filtered to only those present in both
 * the RPC tee and hydration.
 */
export function sortByScores(
  products: Array<{ brandSlug: string; key: string }>,
  scores: number[],
): string[] {
  if (products.length !== scores.length) {
    throw new Error(
      `products.length (${products.length}) !== scores.length (${scores.length})`,
    );
  }
  const indexed = scores.map((s, i) => ({ s, i }));
  indexed.sort((a, b) => b.s - a.s);
  return indexed.map((x) => compositeKey(products[x.i]!));
}

// ---------------------------------------------------------------------------
// toFeatureCsv
// ---------------------------------------------------------------------------

export function toFeatureCsv(rows: ExportRow[]): string {
  const header = `qid,brandSlug,productKey,grade,${FEATURE_NAMES.join(",")}`;
  const hashLine = `# featureSpecHash=${featureSpecHash}`;
  const dataLines = rows.map((row) => {
    const featureValues = Array.from(row.features)
      .map((v) => v.toString())
      .join(",");
    return `${row.qid},${row.brandSlug},${row.productKey},${row.grade},${featureValues}`;
  });
  return [header, hashLine, ...dataLines].join("\n");
}

// ---------------------------------------------------------------------------
// cmdExportFeatures
// ---------------------------------------------------------------------------

export async function cmdExportFeatures(
  values: Record<string, unknown>,
): Promise<void> {
  const splits = (String(values.split ?? "train,val,holdout")).split(",");
  const datasetPath = values.dataset
    ? String(values.dataset)
    : resolve(SCRIPT_DIR, "situation-search-v2.json");

  for (const split of splits) {
    const items = loadDatasetV2(datasetPath, { split });
    const allRows: ExportRow[] = [];

    console.log(`[export-features] split=${split} items=${items.length}`);

    for (const item of items) {
      // Build grades map from expected
      const grades = new Map<string, number>();
      for (const exp of item.expected) {
        grades.set(
          compositeKey({ brandSlug: exp.brandSlug, key: exp.productKey }),
          exp.grade,
        );
      }

      // RPC tee to capture raw rows
      const teed: RpcRow[] = [];
      const baseDeps = createDefaultSearchDeps();
      const deps: SearchDeps = {
        ...baseDeps,
        rpc: async (name, params) => {
          const result = await baseDeps.rpc(name, params);
          if (result.data) teed.push(...(result.data as RpcRow[]));
          return result;
        },
      };

      const result = await searchProductsBySituation(
        {
          query: item.query,
          locale: "zh-TW",
          mode: "hybrid",
          pageSize: 100,
          enableIntentParse: false,
          category: item.category ?? null,
        },
        deps,
      );

      // Build productMap from hydrated products
      const productMap = new Map(
        result.products.map((p) => [
          p.id,
          { brandSlug: p.brandSlug, key: p.key },
        ]),
      );

      // Fetch doc features
      const docFeatures = await fetchDocFeatures(
        result.products.map((p) => p.id),
      );

      // Build export rows
      const rows = buildExportRows(
        item.id,
        teed,
        docFeatures,
        productMap,
        grades,
        item.query,
      );
      allRows.push(...rows);

      console.log(`  ${item.id}: ${rows.length} rows`);
    }

    // Write CSV
    const csv = toFeatureCsv(allRows);
    const outPath = resolve(RUNS_DIR, `dev-1736-features-${split}.csv`);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, csv);
    console.log(`[export-features] wrote ${outPath} (${allRows.length} rows)`);
  }
}
