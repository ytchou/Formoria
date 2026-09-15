/**
 * @formoria-script
 * purpose: Brand centroid recommendation eval — uploads golden set to Langfuse, runs centroid + random arms, LLM-judges relevance.
 * class: operator
 * invoke: pnpm brand-centroid:eval
 * target: staging-default
 * safety: read-only
 * owner: engineering
 * notes: `dataset` subcommand writes to Langfuse; `run` reads production product_embeddings
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { parseArgs } from "node:util";

import { loadScriptTarget } from "../shared/target";
import { computeCentroid } from "@/lib/services/brand-embeddings";
import { createServiceClient } from "@/lib/supabase/service";
import { createOpenAIClient } from "@/lib/services/openai-client";
import { getLangfuse, flushLangfuse } from "@/lib/langfuse/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GoldenItem = {
  id: string;
  brandSlug: string;
  category: string;
  note?: string;
};

type BrandCentroid = {
  brandId: string;
  brandSlug: string;
  category: string;
  centroid: number[];
  productCount: number;
};

type BrandInfo = {
  id: string;
  slug: string;
  name: string | null;
  nameZh: string | null;
  category: string | null;
  subcategories: string[] | null;
};

type JudgePair = {
  seedSlug: string;
  candidateSlug: string;
  arm: "centroid" | "random";
  score: number;
  latencyMs: number;
};

type ArmReport = {
  arm: "centroid" | "random";
  precisionAt5: number;
  categoryCoherence: number;
  p95LatencyMs: number;
  pairs: JudgePair[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname);
const GOLDEN_PATH = resolve(SCRIPT_DIR, "brand-centroid-golden.json");
const RUNS_DIR = resolve(SCRIPT_DIR, "runs");
const PAGE_SIZE = 500;

const JUDGE_PROMPT = `You are evaluating brand similarity for a Taiwanese product discovery platform.

Given a seed brand and a candidate brand (both described by their name, category, subcategories, and product descriptions), rate how likely a shopper browsing the seed brand would also be interested in the candidate brand.

Score:
0 = Not related at all (different categories, different use cases)
1 = Weakly related (same broad category but different target audience or style)
2 = Moderately related (similar products, overlapping audience)
3 = Strongly related (very similar products, same target audience, complementary offerings)

Respond with only the integer score (0, 1, 2, or 3).`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadGolden(): GoldenItem[] {
  return JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as GoldenItem[];
}

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 1;
  return 1 - dot / denom;
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)]!;
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

/** Load all product embeddings grouped by brand, with brand metadata. */
async function loadAllBrandCentroids(): Promise<BrandCentroid[]> {
  const supabase = createServiceClient();

  type EmbeddingRow = {
    product_id: string;
    embedding: number[] | string;
    curated_products: { brand_id: string };
  };

  const rows: { brand_id: string; embedding: number[] }[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("product_embeddings")
      .select(
        "product_id, embedding, curated_products!inner(brand_id)",
      )
      .order("product_id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`product_embeddings read: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const row of data as unknown as EmbeddingRow[]) {
      const cp = row.curated_products as unknown as { brand_id: string };
      rows.push({
        brand_id: cp.brand_id,
        embedding:
          typeof row.embedding === "string"
            ? JSON.parse(row.embedding)
            : row.embedding,
      });
    }

    from += data.length;
    if (data.length < PAGE_SIZE) break;
  }

  // Group by brand_id
  const groups = new Map<string, number[][]>();
  for (const row of rows) {
    let arr = groups.get(row.brand_id);
    if (!arr) {
      arr = [];
      groups.set(row.brand_id, arr);
    }
    arr.push(row.embedding);
  }

  // Fetch brand metadata for all brand_ids
  const brandIds = [...groups.keys()];
  const brandMap = new Map<string, BrandInfo>();
  for (let i = 0; i < brandIds.length; i += PAGE_SIZE) {
    const batch = brandIds.slice(i, i + PAGE_SIZE);
    const { data, error } = await supabase
      .from("brands")
      .select("id, slug, name, name_zh, category, subcategories")
      .in("id", batch);
    if (error) throw new Error(`brands read: ${error.message}`);
    for (const row of data ?? []) {
      brandMap.set(row.id, {
        id: row.id,
        slug: row.slug,
        name: row.name,
        nameZh: row.name_zh,
        category: row.category,
        subcategories: row.subcategories,
      });
    }
  }

  // Compute centroids
  const centroids: BrandCentroid[] = [];
  for (const [brandId, embeddings] of groups) {
    const brand = brandMap.get(brandId);
    if (!brand) continue;
    centroids.push({
      brandId,
      brandSlug: brand.slug,
      category: brand.category ?? "",
      centroid: computeCentroid(embeddings),
      productCount: embeddings.length,
    });
  }

  return centroids;
}

/** Fetch brand info by slugs. */
async function getBrandInfoBySlugs(
  slugs: string[],
): Promise<Map<string, BrandInfo>> {
  const supabase = createServiceClient();
  const map = new Map<string, BrandInfo>();

  for (let i = 0; i < slugs.length; i += PAGE_SIZE) {
    const batch = slugs.slice(i, i + PAGE_SIZE);
    const { data, error } = await supabase
      .from("brands")
      .select("id, slug, name, name_zh, category, subcategories")
      .in("slug", batch);
    if (error) throw new Error(`brands by slug: ${error.message}`);
    for (const row of data ?? []) {
      map.set(row.slug, {
        id: row.id,
        slug: row.slug,
        name: row.name,
        nameZh: row.name_zh,
        category: row.category,
        subcategories: row.subcategories,
      });
    }
  }

  return map;
}

/** Fetch product descriptions for a brand (from curated_products). */
async function getProductDescriptions(brandId: string): Promise<string[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("curated_products")
    .select("product_description")
    .eq("brand_id", brandId)
    .not("product_description", "is", null);
  if (error) throw new Error(`curated_products read: ${error.message}`);
  return (data ?? [])
    .map((row) => row.product_description as string)
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// LLM Judge
// ---------------------------------------------------------------------------

async function judgePair(
  seed: BrandInfo,
  seedDescriptions: string[],
  candidate: BrandInfo,
  candidateDescriptions: string[],
  openai: ReturnType<typeof createOpenAIClient>,
): Promise<{ score: number; latencyMs: number }> {
  const seedProfile = [
    `Name: ${seed.nameZh ?? seed.name ?? seed.slug}`,
    `Category: ${seed.category ?? "unknown"}`,
    `Subcategories: ${(seed.subcategories ?? []).join(", ") || "none"}`,
    `Products: ${seedDescriptions.slice(0, 5).join("; ") || "none available"}`,
  ].join("\n");

  const candidateProfile = [
    `Name: ${candidate.nameZh ?? candidate.name ?? candidate.slug}`,
    `Category: ${candidate.category ?? "unknown"}`,
    `Subcategories: ${(candidate.subcategories ?? []).join(", ") || "none"}`,
    `Products: ${candidateDescriptions.slice(0, 5).join("; ") || "none available"}`,
  ].join("\n");

  const userPrompt = `Seed brand:\n${seedProfile}\n\nCandidate brand:\n${candidateProfile}`;

  const start = performance.now();
  const result = await openai.chat({
    system: JUDGE_PROMPT,
    user: userPrompt,
    temperature: 0,
    maxTokens: 4,
    timeoutMs: 15_000,
  });
  const latencyMs = performance.now() - start;

  if (!result.ok || !result.content) {
    console.warn(`  [judge] Failed for ${seed.slug} vs ${candidate.slug}: status=${result.status}`);
    return { score: -1, latencyMs };
  }

  const parsed = parseInt(result.content.trim(), 10);
  const score = Number.isNaN(parsed) ? -1 : Math.min(3, Math.max(0, parsed));
  return { score, latencyMs };
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
      datasetName: "brand-centroid-v1",
      id: item.id,
      input: { brandSlug: item.brandSlug, category: item.category },
      expectedOutput: {},
    });
    console.log(`  ${item.id}`);
  }

  await flushLangfuse();
  console.log("[dataset] Done.");
}

// ---------------------------------------------------------------------------
// Subcommand: run
// ---------------------------------------------------------------------------

async function cmdRun(k: number) {
  const golden = loadGolden();
  const openai = createOpenAIClient({ model: "gpt-4o-mini" });

  console.log("[run] Loading all brand centroids from production…");
  const allCentroids = await loadAllBrandCentroids();
  console.log(`[run] Loaded ${allCentroids.length} brand centroids.`);

  // Index centroids by slug and category
  const centroidBySlug = new Map<string, BrandCentroid>();
  const centroidsByCategory = new Map<string, BrandCentroid[]>();
  for (const c of allCentroids) {
    centroidBySlug.set(c.brandSlug, c);
    let arr = centroidsByCategory.get(c.category);
    if (!arr) {
      arr = [];
      centroidsByCategory.set(c.category, arr);
    }
    arr.push(c);
  }

  // Pre-fetch brand info for all golden slugs
  const goldenSlugs = golden.map((g) => g.brandSlug);
  const goldenBrandInfo = await getBrandInfoBySlugs(goldenSlugs);

  // Fetch approved brands by category for random arm
  const supabase = createServiceClient();
  const approvedByCategory = new Map<string, BrandInfo[]>();
  for (const category of new Set(golden.map((g) => g.category))) {
    const { data, error } = await supabase
      .from("brands")
      .select("id, slug, name, name_zh, category, subcategories")
      .eq("category", category)
      .eq("status", "approved");
    if (error) throw new Error(`approved brands read: ${error.message}`);
    const brands = (data ?? []).map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      nameZh: row.name_zh,
      category: row.category,
      subcategories: row.subcategories,
    }));
    approvedByCategory.set(category, brands);
  }

  const centroidPairs: JudgePair[] = [];
  const randomPairs: JudgePair[] = [];

  const langfuse = getLangfuse();
  const runName = `brand-centroid-${new Date().toISOString().slice(0, 19)}`;

  for (let gi = 0; gi < golden.length; gi++) {
    const item = golden[gi]!;
    const seedInfo = goldenBrandInfo.get(item.brandSlug);
    if (!seedInfo) {
      console.warn(`[run] Skipping ${item.brandSlug}: not found in brands`);
      continue;
    }

    const seedCentroid = centroidBySlug.get(item.brandSlug);
    if (!seedCentroid) {
      console.warn(`[run] Skipping ${item.brandSlug}: no centroid`);
      continue;
    }

    console.log(`[run] (${gi + 1}/${golden.length}) ${item.brandSlug}…`);

    const seedDescriptions = await getProductDescriptions(seedInfo.id);

    // --- Centroid arm ---
    const categoryCentroids = (centroidsByCategory.get(item.category) ?? [])
      .filter((c) => c.brandSlug !== item.brandSlug);
    const ranked = categoryCentroids
      .map((c) => ({
        ...c,
        distance: cosineDistance(seedCentroid.centroid, c.centroid),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, k);

    const centroidCandidateSlugs = ranked.map((r) => r.brandSlug);
    const centroidCandidateInfo = await getBrandInfoBySlugs(centroidCandidateSlugs);

    for (const candidate of ranked) {
      const candInfo = centroidCandidateInfo.get(candidate.brandSlug);
      if (!candInfo) continue;
      const candDescriptions = await getProductDescriptions(candInfo.id);
      const { score, latencyMs } = await judgePair(
        seedInfo,
        seedDescriptions,
        candInfo,
        candDescriptions,
        openai,
      );
      centroidPairs.push({
        seedSlug: item.brandSlug,
        candidateSlug: candidate.brandSlug,
        arm: "centroid",
        score,
        latencyMs,
      });
    }

    // --- Random arm ---
    const categoryBrands = (approvedByCategory.get(item.category) ?? [])
      .filter((b) => b.slug !== item.brandSlug);
    const shuffled = [...categoryBrands].sort(() => Math.random() - 0.5);
    const randomCandidates = shuffled.slice(0, k);

    for (const candInfo of randomCandidates) {
      const candDescriptions = await getProductDescriptions(candInfo.id);
      const { score, latencyMs } = await judgePair(
        seedInfo,
        seedDescriptions,
        candInfo,
        candDescriptions,
        openai,
      );
      randomPairs.push({
        seedSlug: item.brandSlug,
        candidateSlug: candInfo.slug,
        arm: "random",
        score,
        latencyMs,
      });
    }

    // Langfuse trace per seed
    if (langfuse) {
      const centroidScores = centroidPairs
        .filter((p) => p.seedSlug === item.brandSlug)
        .map((p) => p.score)
        .filter((s) => s >= 0);
      const randomScores = randomPairs
        .filter((p) => p.seedSlug === item.brandSlug)
        .map((p) => p.score)
        .filter((s) => s >= 0);

      langfuse.trace({
        name: `eval:centroid:${item.id}`,
        input: { brandSlug: item.brandSlug, category: item.category, k },
        output: {
          centroidMeanScore: centroidScores.length > 0
            ? centroidScores.reduce((a, b) => a + b, 0) / centroidScores.length
            : null,
          randomMeanScore: randomScores.length > 0
            ? randomScores.reduce((a, b) => a + b, 0) / randomScores.length
            : null,
        },
      });
    }
  }

  // --- Report ---
  const validCentroid = centroidPairs.filter((p) => p.score >= 0);
  const validRandom = randomPairs.filter((p) => p.score >= 0);

  const centroidPrecision = validCentroid.length > 0
    ? validCentroid.filter((p) => p.score >= 2).length / validCentroid.length
    : 0;
  const randomPrecision = validRandom.length > 0
    ? validRandom.filter((p) => p.score >= 2).length / validRandom.length
    : 0;

  const centroidCoherence = validCentroid.length > 0
    ? validCentroid.filter((p) => p.score >= 1).length / validCentroid.length
    : 0;
  const randomCoherence = validRandom.length > 0
    ? validRandom.filter((p) => p.score >= 1).length / validRandom.length
    : 0;

  const centroidReport: ArmReport = {
    arm: "centroid",
    precisionAt5: centroidPrecision,
    categoryCoherence: centroidCoherence,
    p95LatencyMs: p95(centroidPairs.map((p) => p.latencyMs)),
    pairs: centroidPairs,
  };

  const randomReport: ArmReport = {
    arm: "random",
    precisionAt5: randomPrecision,
    categoryCoherence: randomCoherence,
    p95LatencyMs: p95(randomPairs.map((p) => p.latencyMs)),
    pairs: randomPairs,
  };

  // Print table
  console.log("\n| Arm | Precision@5 (≥2) | Category Coherence (≥1) | p95 Latency (ms) |");
  console.log("|-----|-------------------|-------------------------|------------------|");
  for (const r of [centroidReport, randomReport]) {
    console.log(
      `| ${r.arm} | ${r.precisionAt5.toFixed(3)} | ${r.categoryCoherence.toFixed(3)} | ${r.p95LatencyMs.toFixed(0)} |`,
    );
  }

  // Export sample pairs
  const sampleCentroid = centroidPairs.slice(0, 25);
  const sampleRandom = randomPairs.slice(0, 25);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runFile = resolve(RUNS_DIR, `brand-centroid-${timestamp}.json`);
  mkdirSync(dirname(runFile), { recursive: true });
  writeFileSync(
    runFile,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        k,
        runName,
        goldenCount: golden.length,
        totalCentroids: allCentroids.length,
        results: {
          centroid: centroidReport,
          random: randomReport,
        },
        samplePairs: [...sampleCentroid, ...sampleRandom],
      },
      null,
      2,
    ),
  );
  console.log(`\n[run] Results written to ${runFile}`);

  if (langfuse) {
    await flushLangfuse();
    console.log(`[run] Langfuse run: ${runName}`);
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
      k: { type: "string", default: "5" },
    },
  });

  const subcommand = positionals[0];

  switch (subcommand) {
    case "dataset":
      await cmdDataset();
      break;
    case "run":
      await cmdRun(parseInt(values.k ?? "5", 10));
      break;
    default:
      console.error("Usage: brand-centroid:eval <dataset|run>");
      console.error("  dataset                 Upload golden set to Langfuse");
      console.error("  run [--k 5]             Run centroid + random arms with LLM judge");
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
