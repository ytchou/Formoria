/**
 * @formoria-script
 * purpose: Retrieval evaluation harness — uploads golden set to Langfuse, runs search arms, computes metrics, reports neighbours.
 * class: operator
 * invoke: pnpm search:eval
 * target: staging-default
 * safety: read-only
 * owner: engineering
 * notes: `dataset` subcommand writes to Langfuse; `run` and `neighbours` are read-only against the database
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { parseArgs } from "node:util";

import { loadScriptTarget } from "../shared/target";
import {
  searchProductsBySituation,
  findSimilarProducts,
  type SearchMode,
} from "@/lib/services/product-situation-search";
import { getPublishedCuratedProducts } from "@/lib/services/curated-products-catalog";
import { rerankProducts } from "@/lib/services/product-rerank";
import { getLangfuse, flushLangfuse } from "@/lib/langfuse/client";
import {
  precisionAtK,
  recallAtK,
  mrr,
  mean,
  p95,
  verdict,
  resolveExpected,
  type ArmResult,
  type QueryResult,
  type GoldenItem,
} from "./metrics";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname);
const GOLDEN_PATH = resolve(SCRIPT_DIR, "retrieval-golden.json");
const RUNS_DIR = resolve(SCRIPT_DIR, "runs");

function loadGolden(): GoldenItem[] {
  return JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as GoldenItem[];
}

type ArmName = "all" | "category" | "lexical" | "vector" | "hybrid" | "rerank";

const ARMS: ArmName[] = [
  "category",
  "lexical",
  "vector",
  "hybrid",
  "rerank",
];

/**
 * Build the default lookup function that queries the curated product catalog.
 */
function defaultLookup() {
  return async (_slugs: string[]) => {
    const { products } = await getPublishedCuratedProducts({ pageSize: 1000 });
    const map = new Map<
      string,
      { id: string; key: string; brandSlug: string }
    >();
    for (const p of products) {
      map.set(`${p.brandSlug}:${p.key}`, {
        id: p.id,
        key: p.key,
        brandSlug: p.brandSlug,
      });
    }
    return map;
  };
}

// ---------------------------------------------------------------------------
// Subcommand: dataset
// ---------------------------------------------------------------------------

async function cmdDataset() {
  const golden = loadGolden();
  const langfuse = getLangfuse();

  if (!langfuse) {
    console.error(
      "[dataset] Langfuse not configured (missing LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_HOST)",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`[dataset] Uploading ${golden.length} items to Langfuse…`);

  for (const item of golden) {
    await langfuse.createDatasetItem({
      datasetName: "situation-search-v1",
      id: item.id,
      input: { query: item.query, category: item.category ?? null },
      expectedOutput: { expected: item.expected },
    });
    console.log(`  ${item.id}`);
  }

  await flushLangfuse();
  console.log("[dataset] Done.");
}

// ---------------------------------------------------------------------------
// Subcommand: run
// ---------------------------------------------------------------------------

async function runArm(
  armName: string,
  item: GoldenItem,
  expectedIds: string[],
  k: number,
): Promise<QueryResult> {
  const start = performance.now();
  let retrievedIds: string[] = [];

  if (armName === "category") {
    // Category arm: fetch by category, no search
    if (item.category) {
      const { products } = await getPublishedCuratedProducts({
        category: item.category,
        sort: "newest",
        pageSize: k,
      });
      retrievedIds = products.map((p) => p.id);
    }
  } else if (armName === "rerank") {
    // Hybrid top-20 -> rerank -> top-k
    const result = await searchProductsBySituation({
      query: item.query,
      locale: "zh-TW",
      mode: "hybrid",
      pageSize: 20,
      category: item.category ?? null,
    });
    const candidates = result.products.map((p) => ({
      id: p.id,
      document: `${p.nameZh} ${p.category} ${p.subcategory}`,
    }));
    const reranked = await rerankProducts(item.query, candidates);
    retrievedIds = reranked.slice(0, k).map((c) => c.id);
  } else {
    // lexical / vector / hybrid
    const mode = armName as SearchMode;
    const result = await searchProductsBySituation({
      query: item.query,
      locale: "zh-TW",
      mode,
      pageSize: k,
      category: item.category ?? null,
    });
    retrievedIds = result.products.map((p) => p.id);
  }

  const latencyMs = performance.now() - start;

  return {
    queryId: item.id,
    retrieved: retrievedIds,
    expected: expectedIds,
    precisionAtK: precisionAtK(retrievedIds, expectedIds, k),
    recallAtK: recallAtK(retrievedIds, expectedIds, k),
    mrr: mrr(retrievedIds, expectedIds),
    latencyMs,
  };
}

async function cmdRun(armFilter: ArmName, k: number) {
  const golden = loadGolden();
  const { resolved, missing } = await resolveExpected(golden, defaultLookup());

  if (missing.length > 0) {
    console.warn(`[run] ${missing.length} expected products not found:`);
    for (const m of missing) {
      console.warn(`  ${m.queryId}: ${m.brandSlug}/${m.productKey}`);
    }
  }

  const armsToRun = armFilter === "all" ? ARMS : [armFilter];
  const results: ArmResult[] = [];

  for (const arm of armsToRun) {
    console.log(`[run] Running arm: ${arm} (k=${k})…`);
    const perQuery: QueryResult[] = [];

    for (const item of golden) {
      const expectedIds = resolved.get(item.id) ?? [];
      const qr = await runArm(arm, item, expectedIds, k);
      perQuery.push(qr);
    }

    const armResult: ArmResult = {
      arm,
      metrics: {
        meanPrecisionAtK: mean(perQuery.map((q) => q.precisionAtK)),
        meanRecallAtK: mean(perQuery.map((q) => q.recallAtK)),
        meanMrr: mean(perQuery.map((q) => q.mrr)),
        p95LatencyMs: p95(perQuery.map((q) => q.latencyMs)),
      },
      perQuery,
    };
    results.push(armResult);
  }

  // Write run output
  const runFile = resolve(RUNS_DIR, `${new Date().toISOString()}.json`);
  mkdirSync(dirname(runFile), { recursive: true });
  writeFileSync(
    runFile,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        k,
        arms: armsToRun,
        results,
        verdict: verdict(results),
        missing,
      },
      null,
      2,
    ),
  );
  console.log(`\n[run] Results written to ${runFile}`);

  // Print markdown table
  console.log("\n| Arm | P@k | R@k | MRR | p95 (ms) |");
  console.log("|-----|-----|-----|-----|----------|");
  for (const r of results) {
    const m = r.metrics;
    console.log(
      `| ${r.arm} | ${m.meanPrecisionAtK.toFixed(3)} | ${m.meanRecallAtK.toFixed(3)} | ${m.meanMrr.toFixed(3)} | ${m.p95LatencyMs.toFixed(0)} |`,
    );
  }

  console.log(`\nVerdict: ${verdict(results)}`);
}

// ---------------------------------------------------------------------------
// Subcommand: neighbours
// ---------------------------------------------------------------------------

async function cmdNeighbours(limit: number) {
  const golden = loadGolden();
  const { resolved, missing } = await resolveExpected(golden, defaultLookup());

  if (missing.length > 0) {
    console.warn(`[neighbours] ${missing.length} expected products not found`);
  }

  // Collect all unique expected product IDs
  const allIds = new Set<string>();
  for (const ids of resolved.values()) {
    for (const id of ids) {
      allIds.add(id);
    }
  }

  console.log(
    `[neighbours] Finding ${limit} neighbours for ${allIds.size} products…\n`,
  );

  for (const productId of allIds) {
    const { products } = await findSimilarProducts(productId, limit);
    console.log(`### Product: ${productId}`);
    if (products.length === 0) {
      console.log("  (no neighbours found)\n");
      continue;
    }
    for (const p of products) {
      console.log(`  - ${p.nameZh} (${p.brandSlug}/${p.key})`);
    }
    console.log();
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const { argv: remainingArgv } = loadScriptTarget();

  const { positionals, values } = parseArgs({
    args: remainingArgv,
    allowPositionals: true,
    options: {
      arm: { type: "string", default: "all" },
      k: { type: "string", default: "5" },
      limit: { type: "string", default: "5" },
    },
  });

  const subcommand = positionals[0];

  switch (subcommand) {
    case "dataset":
      await cmdDataset();
      break;
    case "run":
      await cmdRun(
        (values.arm ?? "all") as ArmName,
        parseInt(values.k ?? "5", 10),
      );
      break;
    case "neighbours":
      await cmdNeighbours(parseInt(values.limit ?? "5", 10));
      break;
    default:
      console.error("Usage: search:eval <dataset|run|neighbours>");
      console.error("  dataset                          Upload golden set to Langfuse");
      console.error(
        "  run [--arm all|category|lexical|vector|hybrid|rerank] [--k 5]",
      );
      console.error("  neighbours [--limit 5]");
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
