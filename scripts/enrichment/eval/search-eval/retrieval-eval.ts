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
// Prevent LTR reranking from contaminating eval/training data — the env var
// is read at call time inside searchProductsBySituation, not at module load.
process.env.SEARCH_LTR_MODE = 'off';

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { parseArgs } from "node:util";

import { loadScriptTarget } from "../../../shared/target";
import {
  searchProductsBySituation,
  findSimilarProducts,
  findSimilarProductsForTrail,
  createDefaultSearchDeps,
  type SearchDeps,
} from "@/lib/services/product-situation-search";
import { getPublishedCuratedProducts } from "@/lib/services/curated-products-catalog";
import { getPublishedCuratedProductsForTrail } from "@/lib/services/curated-products";
import { getAllTrails } from "@/lib/services/trails";
import {
  buildSourceHash,
  getRelatedBrandsByCentroid,
} from "@/lib/services/brand-embeddings";
import { createServiceClient } from "@/lib/supabase/service";
import {
  rerankProducts,
  buildRerankDocument,
} from "@/lib/services/product-rerank";
import { rerankWithCohere } from "@/lib/services/cohere-rerank-audit";
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
import { loadDatasetV2, toExperimentItems } from "./dataset-v2";
import { writeReport } from "./report";
import { cmdExportFeatures } from "./export-features";
import {
  compositeKey,
  createRetrievalAdapter,
  type RetrievalAdapterDeps,
} from "@/lib/services/eval/retrieval-adapter";
import {
  runExperiment,
  type ExperimentArm,
} from "@/lib/services/eval/run-experiment";
import { createScriptExperimentDeps } from "@/lib/services/eval/script-experiment-deps";
import {
  buildFeatureRows,
  fetchDocFeatures,
  type RpcRow as LtrRpcRow,
} from "@/lib/services/ltr-features";
import { scoreCandidates } from "@/lib/services/ltr-scorer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname);
const RUNS_DIR = resolve(SCRIPT_DIR, "runs");

// ---------------------------------------------------------------------------
// Subcommand: run (v2 — experiment framework)
// ---------------------------------------------------------------------------

async function cmdRun(values: Record<string, unknown>) {
  const armSpecs = String(values.arm ?? "hybrid").split(",");
  const split = String(values.split ?? "holdout");
  const out =
    values.out != null
      ? String(values.out)
      : resolve(RUNS_DIR, `${new Date().toISOString()}.json`);
  const allowUnreviewed = values["allow-unreviewed"] === "true";

  const datasetPath = resolve(SCRIPT_DIR, "situation-search-v2.json");
  const datasetItems = loadDatasetV2(datasetPath, { split });
  const experimentItems = toExperimentItems(datasetItems);

  // Build queryType map for per-type breakdown
  const queryTypes = new Map<string, string>();
  for (const item of datasetItems) {
    if (item.queryType) queryTypes.set(item.id, item.queryType);
  }

  // Build arms
  const arms: ExperimentArm[] = armSpecs.map((spec) => ({
    name: spec,
    type: "custom" as const,
    value: spec,
  }));

  // Build adapter deps — the `rank` dep powers ltr:<version> arms
  const adapterDeps: RetrievalAdapterDeps = {
    search: (input) => searchProductsBySituation(input),
    category: (opts) =>
      getPublishedCuratedProducts({
        category: opts.category,
        pageSize: opts.pageSize,
      }),
    rerank: async (query, candidates) => rerankProducts(query, candidates),
    rerankCohere: async (query, category) => {
      const result = await searchProductsBySituation({
        query,
        locale: "zh-TW",
        mode: "hybrid",
        pageSize: 100,
        category: category ?? null,
        enableIntentParse: false,
      });
      const candidates = result.products.map((p) => ({
        id: p.id,
        document: buildRerankDocument(p),
      }));
      const byId = new Map(result.products.map((p) => [p.id, p]));
      const reranked = await rerankWithCohere(query, candidates, {
        rpcScores: [],
        category: category ?? null,
      });
      return reranked
        .map((r) => {
          const p = byId.get(r.id);
          return p ? compositeKey(p) : "";
        })
        .filter(Boolean);
    },
    rank: async ({ query, version, category }) => {
      const teed: LtrRpcRow[] = [];
      const baseDeps = createDefaultSearchDeps();
      const deps: SearchDeps = {
        ...baseDeps,
        rpc: async (name, params) => {
          const result = await baseDeps.rpc(name, params);
          if (result.data) teed.push(...(result.data as LtrRpcRow[]));
          return result;
        },
      };
      const result = await searchProductsBySituation(
        {
          query,
          locale: "zh-TW",
          mode: "hybrid",
          pageSize: 100,
          enableIntentParse: false,
          category: category ?? null,
        },
        deps,
      );

      const byId = new Map(teed.map((r) => [r.product_id, r]));
      const products = result.products.filter((p) => byId.has(p.id));
      const docs = await fetchDocFeatures(products.map((p) => p.id));
      const rpcForFeatures = products.map((p) => byId.get(p.id)!);
      const feats = buildFeatureRows(query, rpcForFeatures, docs);
      const scores = await scoreCandidates(feats, version);

      const indexed = scores.map((s, i) => ({ s, i }));
      indexed.sort((a, b) => b.s - a.s);
      return indexed.map((x) => compositeKey(products[x.i]!));
    },
  };

  const adapter = createRetrievalAdapter(adapterDeps);
  const deps = await createScriptExperimentDeps({
    adapter,
    profileKey: "search-eval",
  });

  console.log(
    `[run] arms=${armSpecs.join(",")} split=${split} items=${experimentItems.length}`,
  );

  const result = await runExperiment({
    dataset: "situation-search-v2",
    arms,
    adapter,
    items: experimentItems,
    allowUnreviewed,
    deps,
  });

  const report = writeReport(result, {
    seed: 1736,
    out,
    queryTypes,
  });

  console.log(`[run] Verdict: ${report.verdict}`);
  console.log(`[run] Report: ${out}`);

  // Print summary table
  console.log("\n| Arm | NDCG@10 | P@5 | R@100 | MRR |");
  console.log("|-----|---------|-----|-------|-----|");
  for (const [armName, metrics] of Object.entries(report.arms)) {
    const n = metrics["ndcg@10"]!;
    const p = metrics["precision@5"]!;
    const r = metrics["recall@100"]!;
    const m = metrics["mrr"]!;
    console.log(
      `| ${armName} | ${n.mean.toFixed(3)} [${n.lo.toFixed(3)},${n.hi.toFixed(3)}] | ${p.mean.toFixed(3)} | ${r.mean.toFixed(3)} | ${m.mean.toFixed(3)} |`,
    );
  }

  if (report.paired) {
    const d = report.paired.ndcgAt10;
    console.log(
      `\nPaired NDCG@10 delta: ${d.mean.toFixed(4)} [${d.lo.toFixed(4)},${d.hi.toFixed(4)}] p=${d.signTestP.toFixed(4)}`,
    );
  }
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
  const datasetPath = resolve(SCRIPT_DIR, "situation-search-v2.json");
  const datasetItems = loadDatasetV2(datasetPath);
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

  const missingExpected = datasetItems.flatMap((item) =>
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

  console.log(`[snapshot] capturing ${datasetItems.length} search queries`);
  const searchRows = await mapConcurrent(datasetItems, 4, async (item) => {
    const vector = await searchProductsBySituation({
      query: item.query,
      locale: "zh-TW",
      mode: "vector",
      pageSize: 20,
      category: item.category ?? null,
    });
    const hybrid = await searchProductsBySituation({
      query: item.query,
      locale: "zh-TW",
      mode: "hybrid",
      pageSize: 20,
      category: item.category ?? null,
    });
    return [
      item.id,
      {
        query: item.query,
        locale: "zh-TW" as const,
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
  writeFileSync(poolPath, JSON.stringify({ overlap, items: pool }, null, 2));
  console.log(`[compare] wrote blind review pool ${poolPath}`);
  console.log(JSON.stringify({ overlap }, null, 2));

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
// Subcommand: neighbours (v2 — dataset-driven)
// ---------------------------------------------------------------------------

async function cmdNeighbours(values: Record<string, unknown>) {
  const limit = parseInt(String(values.limit ?? "5"), 10);
  const datasetPath = resolve(SCRIPT_DIR, "situation-search-v2.json");
  const items = loadDatasetV2(datasetPath);

  // Collect all unique composite keys from expected
  const allKeys = new Set<string>();
  for (const item of items) {
    for (const exp of item.expected) {
      allKeys.add(
        compositeKey({ brandSlug: exp.brandSlug, key: exp.productKey }),
      );
    }
  }

  // Resolve composite keys to product IDs via catalog
  const { products } = await getPublishedCuratedProducts({
    pageSize: Number.MAX_SAFE_INTEGER,
  });
  const keyToId = new Map<string, string>();
  for (const p of products) {
    keyToId.set(compositeKey(p), p.id);
  }

  const productIds = [...allKeys]
    .map((k) => keyToId.get(k))
    .filter((id): id is string => id != null);

  console.log(
    `[neighbours] Finding ${limit} neighbours for ${productIds.length} products...\n`,
  );

  for (const productId of productIds) {
    const { products: neighbours } = await findSimilarProducts(
      productId,
      limit,
    );
    console.log(`### Product: ${productId}`);
    if (neighbours.length === 0) {
      console.log("  (no neighbours found)\n");
      continue;
    }
    for (const p of neighbours) {
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
      arm: { type: "string", default: "hybrid" },
      k: { type: "string", default: "10" },
      limit: { type: "string", default: "5" },
      split: { type: "string" },
      out: { type: "string" },
      dataset: { type: "string" },
      "allow-unreviewed": { type: "string" },
      variant: { type: "string" },
      output: { type: "string" },
      baseline: { type: "string" },
      candidate: { type: "string" },
      grades: { type: "string" },
      "pool-output": { type: "string" },
      count: { type: "string" },
      seed: { type: "string" },
      samples: { type: "string" },
      temperature: { type: "string" },
      pageSize: { type: "string" },
      human: { type: "string" },
      force: { type: "boolean", default: false },
      "env-file": { type: "string" },
      model: { type: "string" },
      mode: { type: "string" },
      csv: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });

  const subcommand = positionals[0];

  switch (subcommand) {
    case "run":
      await cmdRun(values);
      break;
    case "neighbours":
      await cmdNeighbours(values);
      break;
    case "export-features":
      await cmdExportFeatures(values);
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
    case "export-grades":
      await import("./label-grade-holdout").then((m) =>
        m.cmdExportGrades(values),
      );
      break;
    case "apply-grades":
      await import("./label-grade-holdout").then((m) =>
        m.cmdApplyGrades(values),
      );
      break;
    default:
      console.error(
        "Usage: search:eval <run|neighbours|export-features|snapshot|compare|generate-queries|judge|retrieve-candidates|agreement|build-dataset|export-grades|apply-grades>",
      );
      console.error(
        "  run [--arm hybrid,ltr:v1] [--split holdout] [--out file] [--allow-unreviewed true]",
      );
      console.error("  neighbours [--limit 5]");
      console.error(
        "  export-features [--split train,val,holdout] [--dataset file]",
      );
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
      console.error(
        "  export-grades [--arm hybrid,rerank,rerank:cohere] [--k 10]  Export holdout grades CSV",
      );
      console.error(
        "  apply-grades [--csv labels/holdout-grades.csv]               Apply human grades to dataset",
      );
      process.exitCode = 1;
  }
}

if (!process.env.VITEST) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
