/**
 * Read-only production census of approved brands, quality scoring,
 * bottom-quartile sample of 10 for DEV-1644 routing pilot.
 * Writes cohort JSON to scripts/curation-cohorts/dev-1644-routing-pilot.json.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parsePhaseResults } from "@/lib/services/phase-results";
import type { PhaseResult } from "@/lib/types/curation";
import type { Json } from "@/lib/supabase/database.types";

import { assertCensusTarget } from "./production-guard";
import { createWriteBlockingClient } from "../../lib/readonly-client";
import { loadScriptTarget } from "../../shared/target";

// ---------------------------------------------------------------------------
// Types — exported for tests
// ---------------------------------------------------------------------------

export type BrandSignals = {
  slug: string;
  description: string | null;
  purchase_website: string | null;
  social_instagram: string | null;
  approved_image_count: number;
  published_product_count: number;
  channel_count: number;
};

export type ZeroBrandEntry = {
  slug: string;
  bucket: string;
  reason: string;
};

export type CohortChunk = {
  name: string;
  bucket: string;
  slugs: string[];
  warning: string;
};

export type ChunkResult = {
  smoke: CohortChunk;
  chunks: CohortChunk[];
  all: CohortChunk;
};

export type ZeroCoverageReport = {
  scanned: {
    brands: number;
    products: number;
    sources: number;
    targets: number;
  };
  total: number;
  covered: number;
  zero: number;
  bucketCounts: Record<string, number>;
  reasonCounts: Record<string, number>;
};

// ---------------------------------------------------------------------------
// Pure scoring logic — exported for tests
// ---------------------------------------------------------------------------

/**
 * Quality score: count of filled fields among the six signals.
 * Range 0–6.
 */
export function computeQualityScore(brand: BrandSignals): number {
  let score = 0;
  if (brand.description && brand.description.trim().length > 0) score += 1;
  if (brand.purchase_website && brand.purchase_website.trim().length > 0)
    score += 1;
  if (brand.approved_image_count >= 3) score += 1;
  if (brand.published_product_count >= 1) score += 1;
  if (brand.channel_count >= 1) score += 1;
  if (brand.social_instagram && brand.social_instagram.trim().length > 0)
    score += 1;
  return score;
}

// ---------------------------------------------------------------------------
// Seeded PRNG — mulberry32
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates shuffle with a seeded PRNG, then take the first `n`.
 */
function seededSample<T>(items: T[], n: number, seed: number): T[] {
  const rng = mulberry32(seed);
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

/**
 * Bottom-quartile sample: brands with score <= Q1 value, then draw `n` at random.
 */
export function sampleBottomQuartile(
  brands: Array<{ slug: string; score: number }>,
  n: number,
  seed: number,
): string[] {
  if (brands.length === 0) return [];

  const sorted = brands.map((b) => b.score).sort((a, b) => a - b);
  const q1Index = Math.floor(sorted.length * 0.25);
  const q1Value = sorted[q1Index];

  const bottomQuartile = brands.filter((b) => b.score <= q1Value);
  const sampled = seededSample(bottomQuartile, Math.min(n, bottomQuartile.length), seed);
  return sampled.map((b) => b.slug);
}

// ---------------------------------------------------------------------------
// Zero-coverage: discoverability, bucketing, reason, chunking, report
// ---------------------------------------------------------------------------

/**
 * A curated product is discoverable when all five gates are satisfied:
 * visible, has an official URL, sources have been checked, has a subcategory,
 * and at least one active source exists for it.
 */
export function isDiscoverable(
  product: {
    id: string;
    visible: boolean;
    official_url: string | null;
    source_checked_at: string | null;
    subcategory: string | null;
  },
  activeSourceIds: Set<string>,
): boolean {
  if (!product.visible) return false;
  if (!product.official_url) return false;
  if (!product.source_checked_at) return false;
  if (!product.subcategory) return false;
  if (!activeSourceIds.has(product.id)) return false;
  return true;
}

/** Substring markers for platform-hosted purchase websites. */
const PLATFORM_HOSTS = [
  "shopee",
  "pinkoi",
  "linktr",
  "portaly",
  "wix",
  "shopline",
  "91app",
  "cyberbiz",
  "meepshop",
  "ruten",
  "momo",
  "pchome",
  "etsy",
  "instagram",
  "facebook",
  "threads.net",
  "lit.link",
];

/**
 * Classify a brand by its purchase surface.
 *
 * - Own website → `site:own`
 * - Website on a known platform → `site:<platform>`
 * - No website + marketplace link → `no-site:marketplace`
 * - No website + social only → `no-site:social-only`
 * - Nothing → `no-site:nothing`
 */
export function bucketBrand(brand: {
  purchase_website: string | null;
  purchase_shopee: string | null;
  purchase_pinkoi: string | null;
  purchase_myship: string | null;
  social_instagram: string | null;
  social_facebook: string | null;
  social_threads: string | null;
}): string {
  if (brand.purchase_website) {
    const lower = brand.purchase_website.toLowerCase();
    for (const host of PLATFORM_HOSTS) {
      if (lower.includes(host)) return `site:${host}`;
    }
    return "site:own";
  }

  if (brand.purchase_shopee || brand.purchase_pinkoi || brand.purchase_myship) {
    return "no-site:marketplace";
  }

  if (
    brand.social_instagram ||
    brand.social_facebook ||
    brand.social_threads
  ) {
    return "no-site:social-only";
  }

  return "no-site:nothing";
}

/**
 * Extract a human-readable reason from the latest curation target's products
 * phase. Priority: catalogZeroReason > proposed > detail/error > absent.
 */
export function lastRunReason(
  results: ReadonlyArray<PhaseResult>,
): string {
  const products = results.find((r) => r.phase === "products");
  if (!products) return "absent";
  if (products.catalogZeroReason) return products.catalogZeroReason;
  if (products.productsProposed != null && products.productsProposed > 0)
    return "proposed>0";
  const text = products.detail ?? products.error ?? "";
  return `detail:${text.slice(0, 60)}`;
}

/** Map fine-grained bucket classification to chunk-file bucket name. */
function toChunkBucket(bucket: string): string {
  if (bucket.startsWith("site:")) return "own-site";
  if (bucket === "no-site:marketplace") return "marketplace";
  if (bucket === "no-site:social-only") return "social";
  return "nothing";
}

/**
 * Largest-remainder proportional allocation.
 *
 * When `total >= sizes.length`, every slot gets at least 1.
 * When `total < sizes.length`, only the largest `total` buckets get 1 and
 * the rest get 0 — the invariant `sum(allocations) === total` always holds.
 */
function allocateProportional(sizes: number[], total: number): number[] {
  const grandTotal = sizes.reduce((s, n) => s + n, 0);
  if (grandTotal === 0) return sizes.map(() => 0);

  // When more buckets than slots, give 1 to the `total` largest buckets
  if (sizes.length > total) {
    const indices = sizes
      .map((s, i) => ({ s, i }))
      .sort((a, b) => b.s - a.s)
      .map((e) => e.i);
    const allocations = sizes.map(() => 0);
    for (let k = 0; k < total; k++) {
      allocations[indices[k]] = 1;
    }
    return allocations;
  }

  // Direct proportional targets, floor each with a minimum of 1
  const exact = sizes.map((s) => (total * s) / grandTotal);
  const allocations = exact.map((e) => Math.max(1, Math.floor(e)));
  let sum = allocations.reduce((s, n) => s + n, 0);

  if (sum < total) {
    // Give extras to highest fractional remainders
    const remainders = exact.map((e, i) => e - allocations[i]);
    const indices = remainders
      .map((_, i) => i)
      .sort((a, b) => remainders[b] - remainders[a]);
    for (const i of indices) {
      if (sum >= total) break;
      allocations[i]++;
      sum++;
    }
  } else if (sum > total) {
    // Reduce from largest over-allocations
    const indices = allocations
      .map((_, i) => i)
      .filter((i) => allocations[i] > 1)
      .sort(
        (a, b) => exact[a] - allocations[a] - (exact[b] - allocations[b]),
      );
    for (const i of indices) {
      if (sum <= total) break;
      allocations[i]--;
      sum--;
    }
  }

  return allocations;
}

/**
 * Split zero-coverage brands into a smoke cohort and bucket-chunked files.
 *
 * Smoke is drawn proportionally across chunk buckets (at least one per
 * non-empty bucket), then the remaining brands are chunked into files of at
 * most `options.chunk` brands each.
 */
export function chunkZeroCohorts(
  brands: ZeroBrandEntry[],
  options: { seed: number; smoke: number; chunk: number; prefix: string },
): ChunkResult {
  const { seed, smoke: smokeCount, chunk: chunkSize, prefix } = options;

  // Group by chunk bucket, sort slugs within each for determinism
  const bucketGroups = new Map<string, string[]>();
  for (const brand of brands) {
    const cb = toChunkBucket(brand.bucket);
    const group = bucketGroups.get(cb);
    if (group) group.push(brand.slug);
    else bucketGroups.set(cb, [brand.slug]);
  }
  for (const slugs of bucketGroups.values()) slugs.sort();

  // Sorted bucket entries for deterministic iteration
  const entries = [...bucketGroups.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const sizes = entries.map(([, slugs]) => slugs.length);
  const allocations = allocateProportional(
    sizes,
    Math.min(smokeCount, brands.length),
  );

  // Draw smoke from each bucket with a per-bucket sub-seed
  const smokeSlugs: string[] = [];
  const smokeSet = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    const [, slugs] = entries[i];
    const sampled = seededSample(slugs, allocations[i], seed + i);
    for (const s of sampled) {
      smokeSlugs.push(s);
      smokeSet.add(s);
    }
  }

  // Chunk remaining brands per bucket
  const chunks: CohortChunk[] = [];
  for (const [bucket, allSlugs] of entries) {
    const remaining = allSlugs.filter((s) => !smokeSet.has(s));
    const numChunks = Math.max(1, Math.ceil(remaining.length / chunkSize));
    for (let i = 0; i < numChunks && remaining.length > 0; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, remaining.length);
      if (start >= remaining.length) break;
      chunks.push({
        name: `${prefix}-${bucket}-${i + 1}`,
        bucket,
        slugs: remaining.slice(start, end),
        warning: `DEV-1689 zero-coverage cohort (${bucket}) — production refresh run, visual task`,
      });
    }
  }

  // All file contains every zero-coverage brand
  const allSlugs = brands.map((b) => b.slug).sort();

  return {
    smoke: {
      name: `${prefix}-smoke`,
      bucket: "smoke",
      slugs: smokeSlugs,
      warning:
        "DEV-1689 zero-coverage cohort (smoke) — production refresh run, visual task",
    },
    chunks,
    all: {
      name: `${prefix}-all`,
      bucket: "all",
      slugs: allSlugs,
      warning:
        "DEV-1689 zero-coverage cohort (all) — production refresh run, visual task",
    },
  };
}

/**
 * Assemble the coverage report from scanned row counts and zero-brand entries.
 * Bucket and reason counts each independently sum to the zero total.
 */
export function buildZeroCoverageReport(
  scanned: {
    brands: number;
    products: number;
    sources: number;
    targets: number;
  },
  zeroBrands: ZeroBrandEntry[],
  coveredCount: number,
): ZeroCoverageReport {
  const bucketCounts: Record<string, number> = {};
  const reasonCounts: Record<string, number> = {};

  for (const b of zeroBrands) {
    bucketCounts[b.bucket] = (bucketCounts[b.bucket] ?? 0) + 1;
    reasonCounts[b.reason] = (reasonCounts[b.reason] ?? 0) + 1;
  }

  return {
    scanned,
    total: scanned.brands,
    covered: coveredCount,
    zero: zeroBrands.length,
    bucketCounts,
    reasonCounts,
  };
}

// ---------------------------------------------------------------------------
// Database census (not tested — integration only)
// ---------------------------------------------------------------------------

// PostgREST returns at most db-max-rows (1000) per request and `.limit()` does
// not raise that cap, so a whole-table read silently truncates. Page with
// `.range()` until a short page comes back.
const PAGE = 1000;
async function fetchAllRows<T>(
  build: () => { range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }> },
  label: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(`${label} query failed: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

async function fetchBrandSignals(
  client: ReturnType<typeof createWriteBlockingClient>["client"],
): Promise<BrandSignals[]> {
  // Fetch approved brands with their scalar signals
  const { data: brands, error } = await client
    .from("brands")
    .select("slug, description, purchase_website, social_instagram")
    .eq("status", "approved");

  if (error) throw new Error(`brands query failed: ${error.message}`);
  if (!brands || brands.length === 0) throw new Error("no approved brands found");

  // Count approved images per brand
  const imageCounts = await fetchAllRows<{ brand_id: string }>(
    () => client.from("brand_images").select("brand_id").eq("status", "approved"),
    "brand_images",
  );

  const imageCountMap = new Map<string, number>();
  for (const row of imageCounts) {
    const id = row.brand_id as string;
    imageCountMap.set(id, (imageCountMap.get(id) ?? 0) + 1);
  }

  // Count published curated products per brand
  const productCounts = await fetchAllRows<{ brand_id: string }>(
    () => client.from("curated_products").select("brand_id").eq("visible", true),
    "curated_products",
  );

  const productCountMap = new Map<string, number>();
  for (const row of productCounts) {
    const id = row.brand_id as string;
    productCountMap.set(id, (productCountMap.get(id) ?? 0) + 1);
  }

  // Count brand_channels per brand
  const channelCounts = await fetchAllRows<{ brand_id: string }>(
    () => client.from("brand_channels").select("brand_id"),
    "brand_channels",
  );

  const channelCountMap = new Map<string, number>();
  for (const row of channelCounts) {
    const id = row.brand_id as string;
    channelCountMap.set(id, (channelCountMap.get(id) ?? 0) + 1);
  }

  // We need brand IDs to join counts. Re-fetch with id.
  const { data: brandsWithId, error: idErr } = await client
    .from("brands")
    .select("id, slug, description, purchase_website, social_instagram")
    .eq("status", "approved");

  if (idErr) throw new Error(`brands id query failed: ${idErr.message}`);

  return (brandsWithId ?? []).map((b) => ({
    slug: b.slug as string,
    description: b.description as string | null,
    purchase_website: b.purchase_website as string | null,
    social_instagram: b.social_instagram as string | null,
    approved_image_count: imageCountMap.get(b.id as string) ?? 0,
    published_product_count: productCountMap.get(b.id as string) ?? 0,
    channel_count: channelCountMap.get(b.id as string) ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

function argValue(
  argv: readonly string[],
  flag: string,
): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv.at(index + 1);
}

// ---------------------------------------------------------------------------
// --zero-coverage mode
// ---------------------------------------------------------------------------

async function runZeroCoverage(
  argv: readonly string[],
  target: string,
): Promise<void> {
  const outDir = argValue(argv, "--out-dir") ?? "scripts/curation-cohorts";
  const prefix = argValue(argv, "--prefix") ?? "dev-1689";
  const chunkSize = parseInt(argValue(argv, "--chunk") ?? "25", 10);
  const smokeCount = parseInt(argValue(argv, "--smoke") ?? "10", 10);
  const seed = parseInt(argValue(argv, "--seed") ?? "1689", 10);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env",
    );
  }

  assertCensusTarget({
    supabaseUrl,
    target,
    confirmed: argv.includes("--confirm"),
  });

  const { client, blocked } = createWriteBlockingClient(
    supabaseUrl,
    supabaseKey,
  );

  // 1. Fetch approved brands
  console.log("[zero-coverage] fetching approved brands…");
  const brands = await fetchAllRows<{
    id: string;
    slug: string;
    name: string;
    category: string | null;
    purchase_website: string | null;
    purchase_shopee: string | null;
    purchase_pinkoi: string | null;
    purchase_myship: string | null;
    social_instagram: string | null;
    social_facebook: string | null;
    social_threads: string | null;
  }>(
    () =>
      client
        .from("brands")
        .select(
          "id, slug, name, category, purchase_website, purchase_shopee, purchase_pinkoi, purchase_myship, social_instagram, social_facebook, social_threads",
        )
        .eq("status", "approved"),
    "brands",
  );

  // 2. Fetch curated products
  console.log("[zero-coverage] fetching curated products…");
  const products = await fetchAllRows<{
    id: string;
    brand_id: string;
    visible: boolean;
    official_url: string | null;
    source_checked_at: string | null;
    subcategory: string | null;
  }>(
    () =>
      client
        .from("curated_products")
        .select(
          "id, brand_id, visible, official_url, source_checked_at, subcategory",
        ),
    "curated_products",
  );

  // 3. Fetch active curated product sources
  console.log("[zero-coverage] fetching active product sources…");
  const sources = await fetchAllRows<{ product_id: string }>(
    () =>
      client
        .from("curated_product_sources")
        .select("product_id")
        .eq("state", "active"),
    "curated_product_sources",
  );

  const activeSourceIds = new Set(sources.map((s) => s.product_id));

  // Group products by brand and find zero-coverage brands
  const productsByBrand = new Map<
    string,
    Array<{
      id: string;
      visible: boolean;
      official_url: string | null;
      source_checked_at: string | null;
      subcategory: string | null;
    }>
  >();
  for (const product of products) {
    const group = productsByBrand.get(product.brand_id);
    if (group) group.push(product);
    else productsByBrand.set(product.brand_id, [product]);
  }

  const zeroBrandRows: typeof brands = [];
  let coveredCount = 0;
  for (const brand of brands) {
    const brandProducts = productsByBrand.get(brand.id) ?? [];
    const hasDiscoverable = brandProducts.some((p) =>
      isDiscoverable(p, activeSourceIds),
    );
    if (hasDiscoverable) {
      coveredCount++;
    } else {
      zeroBrandRows.push(brand);
    }
  }

  console.log(
    `[zero-coverage] ${brands.length} approved / ${coveredCount} covered / ${zeroBrandRows.length} zero`,
  );

  // 4. Fetch last-run info for zero brands
  const zeroIds = zeroBrandRows.map((b) => b.id);

  console.log("[zero-coverage] fetching submissions…");
  const submissions: Array<{ id: string; brand_id: string }> = [];
  for (let i = 0; i < zeroIds.length; i += 80) {
    const chunk = zeroIds.slice(i, i + 80);
    const rows = await fetchAllRows<{ id: string; brand_id: string }>(
      () =>
        client
          .from("brand_submissions")
          .select("id, brand_id")
          .eq("intent", "refresh")
          .in("brand_id", chunk),
      "submissions",
    );
    submissions.push(...rows);
  }

  const submissionToBrand = new Map<string, string>();
  for (const sub of submissions) {
    submissionToBrand.set(sub.id, sub.brand_id);
  }

  console.log("[zero-coverage] fetching curation targets…");
  const submissionIds = submissions.map((s) => s.id);
  const targets: Array<{
    target_id: string;
    status: string;
    created_at: string;
    phase_results: Json;
  }> = [];
  for (let i = 0; i < submissionIds.length; i += 80) {
    const chunk = submissionIds.slice(i, i + 80);
    const rows = await fetchAllRows<{
      target_id: string;
      status: string;
      created_at: string;
      phase_results: Json;
    }>(
      () =>
        client
          .from("curation_job_targets")
          .select("target_id, status, created_at, phase_results")
          .eq("target_type", "submission")
          .in("target_id", chunk)
          .order("created_at", { ascending: false }),
      "curation_job_targets",
    );
    targets.push(...rows);
  }

  // Sort globally by created_at desc so first-seen-per-brand is the newest
  targets.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  // Map brand → latest target phase results (first row per brand wins)
  const brandPhaseResults = new Map<string, PhaseResult[]>();
  for (const t of targets) {
    const brandId = submissionToBrand.get(t.target_id);
    if (!brandId) continue;
    if (brandPhaseResults.has(brandId)) continue;
    brandPhaseResults.set(brandId, parsePhaseResults(t.phase_results));
  }

  // Build zero brand entries
  const zeroBrands: ZeroBrandEntry[] = zeroBrandRows.map((brand) => ({
    slug: brand.slug,
    bucket: bucketBrand(brand),
    reason: lastRunReason(brandPhaseResults.get(brand.id) ?? []),
  }));

  // Report
  const report = buildZeroCoverageReport(
    {
      brands: brands.length,
      products: products.length,
      sources: sources.length,
      targets: targets.length,
    },
    zeroBrands,
    coveredCount,
  );

  console.log(`\n[zero-coverage] scanned: ${JSON.stringify(report.scanned)}`);
  console.log(
    `[zero-coverage] total: ${report.total}, covered: ${report.covered}, zero: ${report.zero}`,
  );
  console.log("\n[zero-coverage] bucket counts:");
  for (const [bucket, count] of Object.entries(report.bucketCounts).sort()) {
    console.log(`  ${bucket}: ${count}`);
  }
  console.log("\n[zero-coverage] reason counts:");
  for (const [reason, count] of Object.entries(report.reasonCounts).sort()) {
    console.log(`  ${reason}: ${count}`);
  }

  // Chunk and write
  const result = chunkZeroCohorts(zeroBrands, {
    seed,
    smoke: smokeCount,
    chunk: chunkSize,
    prefix,
  });

  const resolvedOutDir = resolve(outDir);
  await mkdir(resolvedOutDir, { recursive: true });

  async function writeCohortFile(chunk: CohortChunk): Promise<void> {
    const labels: Record<string, string> = {};
    for (const slug of chunk.slugs) labels[slug] = slug;

    const content = {
      name: chunk.name,
      title: `DEV-1689 Zero Coverage — ${chunk.bucket}`,
      subtitle: `${chunk.slugs.length} brands (seed: ${seed})`,
      warning: chunk.warning,
      labels,
    };

    const path = resolve(resolvedOutDir, `${chunk.name}.json`);
    await writeFile(path, JSON.stringify(content, null, 2) + "\n");
    console.log(`[zero-coverage] wrote ${path}`);
  }

  await writeCohortFile(result.smoke);
  for (const chunk of result.chunks) {
    await writeCohortFile(chunk);
  }
  await writeCohortFile(result.all);

  if (blocked.length > 0) {
    console.warn(
      `[zero-coverage] ${blocked.length} blocked writes (should be 0):`,
    );
    for (const b of blocked) {
      console.warn(`  ${b.table}.${b.method}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { argv, target } = loadScriptTarget();

  if (argv.includes("--zero-coverage")) {
    await runZeroCoverage(argv, target);
    return;
  }

  // Parse optional --seed flag
  let seed = Date.now();
  const seedIdx = argv.indexOf("--seed");
  if (seedIdx !== -1 && argv[seedIdx + 1]) {
    seed = parseInt(argv[seedIdx + 1], 10);
    if (Number.isNaN(seed)) throw new Error("--seed must be a number");
  }

  const sampleSize = 10;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env",
    );
  }

  const { client, blocked } = createWriteBlockingClient(supabaseUrl, supabaseKey);

  console.log("[census] fetching approved brand signals…");
  const brands = await fetchBrandSignals(client);
  console.log(`[census] ${brands.length} approved brands`);

  const scored = brands.map((b) => ({
    slug: b.slug,
    score: computeQualityScore(b),
  }));

  // Distribution summary
  const distribution = new Map<number, number>();
  for (const { score } of scored) {
    distribution.set(score, (distribution.get(score) ?? 0) + 1);
  }
  console.log("[census] score distribution:");
  for (const s of [0, 1, 2, 3, 4, 5, 6]) {
    console.log(`  ${s}: ${distribution.get(s) ?? 0}`);
  }

  const sampled = sampleBottomQuartile(scored, sampleSize, seed);
  console.log(`[census] sampled ${sampled.length} brands (seed: ${seed})`);

  // Build cohort labels: slug → slug (no display name needed for pilot)
  const labels: Record<string, string> = {};
  for (const slug of sampled) {
    const brand = brands.find((b) => b.slug === slug);
    labels[slug] = brand?.slug ?? slug;
  }

  const cohort = {
    name: "dev-1644-routing-pilot",
    title: "DEV-1644 Routing Pilot",
    subtitle: `10 bottom-quartile approved brands (seed: ${seed})`,
    warning:
      "Read-only pilot cohort for acquisition agent evaluation",
    labels,
  };

  const outPath = resolve("scripts/curation-cohorts/dev-1644-routing-pilot.json");
  await writeFile(outPath, JSON.stringify(cohort, null, 2) + "\n");
  console.log(`[census] wrote ${outPath}`);

  if (blocked.length > 0) {
    console.warn(`[census] ${blocked.length} blocked writes (should be 0):`);
    for (const b of blocked) {
      console.warn(`  ${b.table}.${b.method}`);
    }
  }
}

if (process.env.VITEST !== 'true') {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
