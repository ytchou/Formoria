/**
 * Read-only production census of approved brands, quality scoring,
 * bottom-quartile sample of 10 for DEV-1644 routing pilot.
 * Writes cohort JSON to scripts/curation-cohorts/dev-1644-routing-pilot.json.
 */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createWriteBlockingClient } from "../lib/readonly-client";
import { loadScriptTarget } from "../shared/target";

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
// Database census (not tested — integration only)
// ---------------------------------------------------------------------------

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
  const { data: imageCounts, error: imgErr } = await client
    .from("brand_images")
    .select("brand_id")
    .eq("status", "approved");

  if (imgErr) throw new Error(`brand_images query failed: ${imgErr.message}`);

  const imageCountMap = new Map<string, number>();
  for (const row of imageCounts ?? []) {
    const id = row.brand_id as string;
    imageCountMap.set(id, (imageCountMap.get(id) ?? 0) + 1);
  }

  // Count published curated products per brand
  const { data: productCounts, error: prodErr } = await client
    .from("curated_products")
    .select("brand_id")
    .eq("published", true);

  if (prodErr)
    throw new Error(`curated_products query failed: ${prodErr.message}`);

  const productCountMap = new Map<string, number>();
  for (const row of productCounts ?? []) {
    const id = row.brand_id as string;
    productCountMap.set(id, (productCountMap.get(id) ?? 0) + 1);
  }

  // Count brand_channels per brand
  const { data: channelCounts, error: chanErr } = await client
    .from("brand_channels")
    .select("brand_id");

  if (chanErr)
    throw new Error(`brand_channels query failed: ${chanErr.message}`);

  const channelCountMap = new Map<string, number>();
  for (const row of channelCounts ?? []) {
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
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { argv } = loadScriptTarget();

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
