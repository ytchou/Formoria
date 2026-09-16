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

import { loadScriptTarget } from "../../../shared/target";
import {
  searchProductsBySituation,
  findSimilarProducts,
  findSimilarProductsForTrail,
  type SearchMode,
} from "@/lib/services/product-situation-search";
import { getPublishedCuratedProducts } from "@/lib/services/curated-products-catalog";
import { getPublishedCuratedProductsForTrail } from "@/lib/services/curated-products";
import { getAllTrails } from "@/lib/services/trails";
import {
  buildSourceHash,
  getRelatedBrandsByCentroid,
} from "@/lib/services/brand-embeddings";
import { createServiceClient } from "@/lib/supabase/service";
import { rerankProducts } from "@/lib/services/product-rerank";
import { getLangfuse, flushLangfuse } from "@/lib/langfuse/client";
import {
  precisionAtK,
  recallAtK,
  mrr,
  mean,
  p95,
} from "@/lib/services/eval/scorers";
import {
  buildBlindReviewPool,
  compareConsumerOverlap,
  evaluateReviewedAnchors,
  evaluateSearchGates,
  resolveTrustedGrades,
  type CorpusHealth,
  type CorpusSnapshot,
  type GradeRecord,
  type SnapshotVariant,
} from "@/lib/services/eval/embedding-corpus-regression";
// ---------------------------------------------------------------------------
// Types (migrated from metrics.ts)
// ---------------------------------------------------------------------------

type GoldenItem = {
  id: string;
  query: string;
  locale: "zh-TW" | "en";
  category?: string;
  expected: Array<{ brandSlug: string; productKey: string }>;
};

type QueryResult = {
  queryId: string;
  retrieved: string[];
  expected: string[];
  precisionAtK: number;
  recallAtK: number;
  mrr: number;
  latencyMs: number;
};

type ArmResult = {
  arm: string;
  metrics: {
    meanPrecisionAtK: number;
    meanRecallAtK: number;
    meanMrr: number;
    p95LatencyMs: number;
  };
  perQuery: QueryResult[];
};

// ---------------------------------------------------------------------------
// Verdict (migrated from metrics.ts)
// ---------------------------------------------------------------------------

/**
 * Decides whether the rerank arm should ship.
 *
 * - "ship": rerank precision@5 improves by >= 0.1 over hybrid AND p95 < 1500ms
 * - "no-lift": precision improvement < 0.1
 * - "too-slow": p95 >= 1500ms despite sufficient lift
 * - "missing-arms": hybrid or rerank arm not present
 */
function verdict(results: ArmResult[]): string {
  const hybrid = results.find((r) => r.arm === "hybrid");
  const rerank = results.find((r) => r.arm === "rerank");

  if (!hybrid || !rerank) return "missing-arms";

  const lift =
    rerank.metrics.meanPrecisionAtK - hybrid.metrics.meanPrecisionAtK;
  const fast = rerank.metrics.p95LatencyMs < 1500;

  if (lift >= 0.1 - 1e-9 && fast) return "ship";
  if (lift < 0.1 - 1e-9) return "no-lift";
  return "too-slow";
}

// ---------------------------------------------------------------------------
// resolveExpected (migrated from metrics.ts)
// ---------------------------------------------------------------------------

type ProductEntry = { id: string; key: string; brandSlug: string };

/**
 * Resolve expected brandSlug+productKey pairs to product IDs.
 *
 * The `lookupFn` parameter allows injection for testing. In production the
 * eval script passes a function that queries the catalog.
 */
async function resolveExpected(
  items: GoldenItem[],
  lookupFn: (slugs: string[]) => Promise<Map<string, ProductEntry>>,
): Promise<{
  resolved: Map<string, string[]>;
  missing: Array<{ queryId: string; brandSlug: string; productKey: string }>;
}> {
  const allSlugs = new Set<string>();
  for (const item of items) {
    for (const exp of item.expected) {
      allSlugs.add(exp.brandSlug);
    }
  }

  const productMap = await lookupFn([...allSlugs]);

  const resolved = new Map<string, string[]>();
  const missing: Array<{
    queryId: string;
    brandSlug: string;
    productKey: string;
  }> = [];

  for (const item of items) {
    const ids: string[] = [];
    for (const exp of item.expected) {
      const compositeKey = `${exp.brandSlug}:${exp.productKey}`;
      const found = productMap.get(compositeKey);
      if (found) {
        ids.push(found.id);
      } else {
        missing.push({
          queryId: item.id,
          brandSlug: exp.brandSlug,
          productKey: exp.productKey,
        });
      }
    }
    resolved.set(item.id, ids);
  }

  return { resolved, missing };
}

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

const ARMS: ArmName[] = ["category", "lexical", "vector", "hybrid", "rerank"];

/**
 * Build the default lookup function that queries the curated product catalog.
 */
function defaultLookup() {
  return async (_slugs: string[]) => {
    const { products, totalCount } = await getPublishedCuratedProducts({
      pageSize: Number.MAX_SAFE_INTEGER,
    });
    if (products.length !== totalCount) {
      throw new Error(
        `catalog read truncated: got ${products.length} of ${totalCount}`,
      );
    }
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
      input: {
        query: item.query,
        locale: item.locale,
        category: item.category ?? null,
      },
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
      locale: item.locale,
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
      locale: item.locale,
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
  const langfuse = getLangfuse();

  if (missing.length > 0) {
    throw new Error(
      `[run] expected products not found:\n${missing
        .map(
          (item) => `  ${item.queryId}: ${item.brandSlug}/${item.productKey}`,
        )
        .join("\n")}`,
    );
  }

  const armsToRun = armFilter === "all" ? ARMS : [armFilter];
  const results: ArmResult[] = [];

  for (const arm of armsToRun) {
    console.log(`[run] Running arm: ${arm} (k=${k})…`);
    const runName = `situation-search-${arm}-${new Date().toISOString().slice(0, 19)}`;
    const perQuery: QueryResult[] = [];

    for (const item of golden) {
      const expectedIds = resolved.get(item.id) ?? [];
      const qr = await runArm(arm, item, expectedIds, k);
      if (langfuse) {
        const trace = langfuse.trace({
          name: `eval:${arm}:${item.id}`,
          input: { query: item.query, arm, k },
          output: {
            precisionAtK: qr.precisionAtK,
            recallAtK: qr.recallAtK,
            mrr: qr.mrr,
            retrievedCount: qr.retrieved.length,
          },
          metadata: { latencyMs: qr.latencyMs },
        });
        await langfuse.createDatasetRunItem({
          datasetItemId: item.id,
          runName,
          traceId: trace.id,
        });
      }
      perQuery.push(qr);
    }

    const scorable = perQuery.filter((q) => q.expected.length > 0);
    const armResult: ArmResult = {
      arm,
      metrics: {
        meanPrecisionAtK: mean(scorable.map((q) => q.precisionAtK)),
        meanRecallAtK: mean(scorable.map((q) => q.recallAtK)),
        meanMrr: mean(scorable.map((q) => q.mrr)),
        p95LatencyMs: p95(perQuery.map((q) => q.latencyMs)),
      },
      perQuery,
    };
    results.push(armResult);

    if (langfuse) {
      await flushLangfuse();
      console.log(`[run] Langfuse run: ${runName}`);
    }
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
// Subcommands: snapshot / compare (DEV-1739)
// ---------------------------------------------------------------------------

type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

type CorpusState = {
  health: CorpusHealth;
  eligibleProductIds: string[];
  centroidBrandIds: string[];
};

async function readAllPages<T>(
  reader: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await reader(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        const item = items[index];
        if (item === undefined) break;
        results[index] = await mapper(item, index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function stableProductId(product: { brandSlug: string; key: string }): string {
  return `${product.brandSlug}/${product.key}`;
}

async function readCorpusState(): Promise<CorpusState> {
  const db = createServiceClient();
  const documents = await readAllPages<{
    product_id: string;
    source_hash: string;
  }>(
    (from, to) =>
      db
        .from("product_embedding_documents")
        .select("product_id, source_hash")
        .order("product_id")
        .range(from, to) as unknown as PromiseLike<
        PageResult<{ product_id: string; source_hash: string }>
      >,
  );
  const embeddings = await readAllPages<{
    product_id: string;
    source_hash: string;
  }>(
    (from, to) =>
      db
        .from("product_embeddings")
        .select("product_id, source_hash")
        .order("product_id")
        .range(from, to) as unknown as PromiseLike<
        PageResult<{
          product_id: string;
          source_hash: string;
        }>
      >,
  );
  const productBrands = await readAllPages<{
    id: string;
    brand_id: string;
  }>(
    (from, to) =>
      db
        .from("curated_products")
        .select("id, brand_id")
        .order("id")
        .range(from, to) as unknown as PromiseLike<
        PageResult<{ id: string; brand_id: string }>
      >,
  );
  const centroids = await readAllPages<{
    brand_id: string;
    source_hash: string;
  }>(
    (from, to) =>
      db
        .from("brand_embeddings")
        .select("brand_id, source_hash")
        .order("brand_id")
        .range(from, to) as unknown as PromiseLike<
        PageResult<{ brand_id: string; source_hash: string }>
      >,
  );

  const documentHashes = new Map(
    documents.map((row) => [row.product_id, row.source_hash]),
  );
  const embeddingHashes = new Map(
    embeddings.map((row) => [row.product_id, row.source_hash]),
  );
  const missingProductEmbeddings = documents.filter(
    (row) => !embeddingHashes.has(row.product_id),
  ).length;
  const staleProductEmbeddings = documents.filter(
    (row) =>
      embeddingHashes.has(row.product_id) &&
      embeddingHashes.get(row.product_id) !== row.source_hash,
  ).length;
  const orphanProductEmbeddings = embeddings.filter(
    (row) => !documentHashes.has(row.product_id),
  ).length;

  const brandProducts = new Map<
    string,
    Array<{ productId: string; sourceHash: string }>
  >();
  const brandByProduct = new Map(
    productBrands.map((row) => [row.id, row.brand_id]),
  );
  for (const row of embeddings) {
    const brandId = brandByProduct.get(row.product_id);
    if (!brandId) continue;
    const entries = brandProducts.get(brandId) ?? [];
    entries.push({ productId: row.product_id, sourceHash: row.source_hash });
    brandProducts.set(brandId, entries);
  }
  const expectedCentroidHashes = new Map(
    [...brandProducts].map(([brandId, entries]) => [
      brandId,
      buildSourceHash(entries),
    ]),
  );
  const centroidHashes = new Map(
    centroids.map((row) => [row.brand_id, row.source_hash]),
  );
  const missingBrandCentroids = [...expectedCentroidHashes.keys()].filter(
    (brandId) => !centroidHashes.has(brandId),
  ).length;
  const staleBrandCentroids = [...expectedCentroidHashes].filter(
    ([brandId, sourceHash]) =>
      centroidHashes.has(brandId) && centroidHashes.get(brandId) !== sourceHash,
  ).length;
  const orphanBrandCentroids = centroids.filter(
    (row) => !expectedCentroidHashes.has(row.brand_id),
  ).length;

  return {
    health: {
      eligibleProducts: documents.length,
      productEmbeddings: embeddings.length,
      missingProductEmbeddings,
      staleProductEmbeddings,
      orphanProductEmbeddings,
      brandCentroids: centroids.length,
      missingBrandCentroids,
      staleBrandCentroids,
      orphanBrandCentroids,
    },
    eligibleProductIds: documents.map((row) => row.product_id),
    centroidBrandIds: centroids.map((row) => row.brand_id),
  };
}

function assertHealthyCorpus(health: CorpusHealth): void {
  const drift =
    health.missingProductEmbeddings +
    health.staleProductEmbeddings +
    health.orphanProductEmbeddings +
    health.missingBrandCentroids +
    health.staleBrandCentroids +
    health.orphanBrandCentroids;
  if (
    health.eligibleProducts === 0 ||
    health.brandCentroids === 0 ||
    drift > 0
  ) {
    throw new Error(`Corpus is not synchronized: ${JSON.stringify(health)}`);
  }
}

async function cmdSnapshot(
  variant: SnapshotVariant,
  outputPath: string,
): Promise<void> {
  const golden = loadGolden();
  const state = await readCorpusState();
  assertHealthyCorpus(state.health);

  const { products, totalCount } = await getPublishedCuratedProducts({
    pageSize: Number.MAX_SAFE_INTEGER,
  });
  if (products.length !== totalCount) {
    throw new Error(
      `Catalog read truncated: got ${products.length} of ${totalCount}`,
    );
  }
  const productById = new Map(products.map((product) => [product.id, product]));
  const productByStableId = new Map(
    products.map((product) => [stableProductId(product), product]),
  );
  const eligibleProducts = state.eligibleProductIds.map((productId) => {
    const product = productById.get(productId);
    if (!product) {
      throw new Error(`Eligible product cannot be hydrated: ${productId}`);
    }
    return product;
  });

  const missingExpected = golden.flatMap((item) =>
    item.expected.flatMap((expected) => {
      const stableId = `${expected.brandSlug}/${expected.productKey}`;
      return productByStableId.has(stableId) ? [] : [`${item.id}: ${stableId}`];
    }),
  );
  if (missingExpected.length > 0) {
    throw new Error(
      `Expected products not found:\n${missingExpected
        .map((item) => `  ${item}`)
        .join("\n")}`,
    );
  }

  console.log(`[snapshot] capturing ${golden.length} search queries`);
  const searchRows = await mapConcurrent(golden, 4, async (item) => {
    const vector = await searchProductsBySituation({
      query: item.query,
      locale: item.locale,
      mode: "vector",
      pageSize: 20,
      category: item.category ?? null,
    });
    const hybrid = await searchProductsBySituation({
      query: item.query,
      locale: item.locale,
      mode: "hybrid",
      pageSize: 20,
      category: item.category ?? null,
    });
    return [
      item.id,
      {
        query: item.query,
        locale: item.locale,
        vector: vector.products.map(stableProductId),
        hybrid: hybrid.products.map(stableProductId),
      },
    ] as const;
  });

  console.log(
    `[snapshot] capturing neighbours for ${eligibleProducts.length} products`,
  );
  const neighbourRows = await mapConcurrent(
    eligibleProducts,
    20,
    async (product, index) => {
      const result = await findSimilarProducts(product.id, 5);
      if ((index + 1) % 100 === 0) {
        console.log(
          `[snapshot] product neighbours ${index + 1}/${eligibleProducts.length}`,
        );
      }
      return [
        stableProductId(product),
        result.products.map(stableProductId),
      ] as const;
    },
  );

  const db = createServiceClient();
  const brandRows = await readAllPages<{
    id: string;
    slug: string;
    name: string;
    category: string | null;
  }>(
    (from, to) =>
      db
        .from("brands")
        .select("id, slug, name, category")
        .eq("status", "approved")
        .eq("is_demo", false)
        .order("id")
        .range(from, to) as unknown as PromiseLike<
        PageResult<{
          id: string;
          slug: string;
          name: string;
          category: string | null;
        }>
      >,
  );
  const brandById = new Map(brandRows.map((brand) => [brand.id, brand]));
  const centroidBrands = state.centroidBrandIds.map((brandId) => {
    const brand = brandById.get(brandId);
    if (!brand?.category) {
      throw new Error(
        `Centroid brand is missing an approved category: ${brandId}`,
      );
    }
    return { ...brand, category: brand.category };
  });
  console.log(
    `[snapshot] capturing related brands for ${centroidBrands.length} brands`,
  );
  const relatedBrandRows = await mapConcurrent(
    centroidBrands,
    10,
    async (brand) => {
      const result = await getRelatedBrandsByCentroid(
        brand.id,
        brand.category,
        brand.slug,
        4,
      );
      return [brand.slug, result.brands.map((item) => item.slug)] as const;
    },
  );

  const trailsResult = await getAllTrails("zh-TW");
  if (!trailsResult.ok) throw trailsResult.error;
  console.log(
    `[snapshot] capturing similar products for ${trailsResult.trails.length} trails`,
  );
  const trailRows = await mapConcurrent(
    trailsResult.trails,
    5,
    async (trail) => {
      const placed = await getPublishedCuratedProductsForTrail(trail.slug);
      const similar = await findSimilarProductsForTrail(
        placed.map((product) => product.id),
        6,
      );
      return [trail.slug, similar.map(stableProductId)] as const;
    },
  );

  const snapshot: CorpusSnapshot = {
    schemaVersion: 1,
    variant,
    createdAt: new Date().toISOString(),
    corpusHealth: state.health,
    products: Object.fromEntries(
      products.map((product) => [
        stableProductId(product),
        {
          nameZh: product.nameZh,
          nameEn: product.nameEn,
          category: product.category,
        },
      ]),
    ),
    brands: Object.fromEntries(
      brandRows.map((brand) => [brand.slug, { name: brand.name }]),
    ),
    search: Object.fromEntries(searchRows),
    productNeighbours: Object.fromEntries(neighbourRows),
    relatedBrands: Object.fromEntries(relatedBrandRows),
    trails: Object.fromEntries(trailRows),
    trailLabels: Object.fromEntries(
      trailsResult.trails.map((trail) => [trail.slug, trail.frontmatter.title]),
    ),
  };
  const absoluteOutput = resolve(process.cwd(), outputPath);
  mkdirSync(dirname(absoluteOutput), { recursive: true });
  writeFileSync(absoluteOutput, JSON.stringify(snapshot, null, 2));
  console.log(`[snapshot] wrote ${absoluteOutput}`);
}

function readSnapshot(path: string): CorpusSnapshot {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), path), "utf8"),
  ) as CorpusSnapshot;
}

async function cmdCompare(options: {
  baseline: string;
  candidate: string;
  grades?: string;
  poolOutput: string;
  output?: string;
}): Promise<void> {
  const baseline = readSnapshot(options.baseline);
  const candidate = readSnapshot(options.candidate);
  if (baseline.variant !== "baseline" || candidate.variant !== "candidate") {
    throw new Error(
      "Compare requires baseline and candidate snapshot variants",
    );
  }

  const overlap = compareConsumerOverlap(baseline, candidate);
  const pool = buildBlindReviewPool(baseline, candidate, overlap);
  const poolPath = resolve(process.cwd(), options.poolOutput);
  mkdirSync(dirname(poolPath), { recursive: true });
  writeFileSync(poolPath, JSON.stringify({ items: pool }, null, 2));
  console.log(`[compare] wrote blind review pool ${poolPath}`);

  if (!options.grades) {
    console.error(
      `[compare] ${pool.length} pooled candidates require blind 0-3 grades before gates can run`,
    );
    process.exitCode = 2;
    return;
  }
  const gradeFile = JSON.parse(
    readFileSync(resolve(process.cwd(), options.grades), "utf8"),
  ) as { grades?: GradeRecord[] } | GradeRecord[];
  const records = Array.isArray(gradeFile) ? gradeFile : gradeFile.grades;
  if (!records) throw new Error("Grade file must contain a grades array");
  const trusted = resolveTrustedGrades(pool, records);
  const search = evaluateSearchGates(baseline, candidate, trusted.grades);
  const reviewed = evaluateReviewedAnchors(
    baseline,
    candidate,
    overlap,
    trusted.grades,
  );
  const passed =
    overlap.passed && search.passed && reviewed.every((item) => item.passed);
  const report = {
    passed,
    gradeMode: trusted.mode,
    weightedKappa: trusted.kappa,
    search,
    overlap,
    reviewed,
  };
  console.log(JSON.stringify(report, null, 2));
  if (options.output) {
    const reportPath = resolve(process.cwd(), options.output);
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }
  if (!passed) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Subcommand: neighbours
// ---------------------------------------------------------------------------

async function cmdNeighbours(limit: number) {
  const golden = loadGolden();
  const { resolved, missing } = await resolveExpected(golden, defaultLookup());

  if (missing.length > 0) {
    throw new Error(
      `[neighbours] expected products not found:\n${missing
        .map(
          (item) => `  ${item.queryId}: ${item.brandSlug}/${item.productKey}`,
        )
        .join("\n")}`,
    );
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
      variant: { type: "string" },
      output: { type: "string" },
      baseline: { type: "string" },
      candidate: { type: "string" },
      grades: { type: "string" },
      "pool-output": { type: "string" },
      help: { type: "boolean", default: false },
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
    case "snapshot": {
      if (
        (values.variant !== "baseline" && values.variant !== "candidate") ||
        !values.output
      ) {
        throw new Error(
          "snapshot requires --variant baseline|candidate and --output <file>",
        );
      }
      await cmdSnapshot(values.variant, values.output);
      break;
    }
    case "compare": {
      if (!values.baseline || !values.candidate || !values["pool-output"]) {
        throw new Error(
          "compare requires --baseline <file> --candidate <file> --pool-output <file>",
        );
      }
      await cmdCompare({
        baseline: values.baseline,
        candidate: values.candidate,
        poolOutput: values["pool-output"],
        ...(values.grades ? { grades: values.grades } : {}),
        ...(values.output ? { output: values.output } : {}),
      });
      break;
    }
    case "generate-queries":
      await import("./label-generate-queries").then((m) =>
        m.cmdGenerateQueries(values),
      );
      break;
    case "judge":
      await import("./label-judge").then((m) => m.cmdJudge(values));
      break;
    case "retrieve-candidates":
      await import("./label-judge").then((m) =>
        m.cmdRetrieveCandidates(values),
      );
      break;
    case "agreement":
      await import("./label-agreement").then((m) => m.cmdAgreement(values));
      break;
    case "build-dataset":
      await import("./label-build-dataset").then((m) =>
        m.cmdBuildDataset(values),
      );
      break;
    default:
      console.error(
        "Usage: search:eval <dataset|run|neighbours|snapshot|compare|generate-queries|judge|retrieve-candidates|agreement|build-dataset>",
      );
      console.error(
        "  dataset                          Upload golden set to Langfuse",
      );
      console.error(
        "  run [--arm all|category|lexical|vector|hybrid|rerank] [--k 5]",
      );
      console.error("  neighbours [--limit 5]");
      console.error("  snapshot --variant baseline|candidate --output <file>");
      console.error(
        "  compare --baseline <file> --candidate <file> --pool-output <file> [--grades <file>] [--output <report>]",
      );
      console.error(
        "  generate-queries [--count 100]   Generate zh-TW situation query candidates",
      );
      console.error(
        "  judge [--model gpt-4o-mini]      Run LLM judge on (query, product) pairs",
      );
      console.error("  retrieve-candidates [--mode hybrid] [--pageSize 100]");
      console.error(
        "  agreement [--human f] [--llm f]  Compute Cohen's kappa between labels",
      );
      console.error(
        "  build-dataset [--split 60/20/20] Build labelled dataset for Langfuse",
      );
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
