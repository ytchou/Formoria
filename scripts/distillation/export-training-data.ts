/**
 * @formoria-script
 * purpose: Export product classification training data (L1 category + L2 subcategory) for distillation.
 * class: operator
 * invoke: pnpm distill:export
 * target: staging-default
 * safety: read-only
 * owner: engineering
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { L1_CATEGORIES, L2_SUBCATEGORIES } from "@/lib/taxonomy/ontology";

import { createWriteBlockingClient } from "../lib/readonly-client";
import { loadScriptTarget } from "../shared/target";

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TrainingMessage = {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
};

type ProductRow = {
  id: string;
  name_zh: string;
  product_description_zh: string | null;
  category: string;
  subcategory: string | null;
  brand_id: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_L1_SLUGS: Set<string> = new Set(L1_CATEGORIES.map((c) => c.slug));
const VALID_L2_SLUGS: Set<string> = new Set(
  L2_SUBCATEGORIES.map((s) => s.slug),
);

const RUNS_DIR = resolve(import.meta.dirname, "runs");
const PAGE = 1000;

// ---------------------------------------------------------------------------
// Build system prompt with L1 + L2 taxonomy
// ---------------------------------------------------------------------------

function buildSystemPrompt(): string {
  // Compact format: L1(L2,L2,...) to keep the prompt under ~600 tokens
  const taxonomyLines = L1_CATEGORIES.map((c) => {
    const subs = L2_SUBCATEGORIES.filter((s) => s.category === c.slug)
      .map((s) => s.slug)
      .join(",");
    return `${c.slug}(${c.nameZh}): ${subs}`;
  })
    .filter((line) => !line.endsWith(": "))
    .join("\n");

  return `產品分類助手。根據產品名稱與描述，回覆 JSON：{"category":"<L1>","subcategory":"<L2>","confidence":"high|medium|low"}

分類體系（L1→L2）：
${taxonomyLines}

規則：subcategory 必須屬於該 category。直接回覆 JSON。`;
}

// ---------------------------------------------------------------------------
// Paginated fetch
// ---------------------------------------------------------------------------

async function selectAllPages<T>(
  run: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1);
    if (error) throw new Error(`${label} query failed: ${error.message}`);
    const page = data ?? [];
    all.push(...page);
    if (page.length < PAGE) return all;
  }
}

// ---------------------------------------------------------------------------
// Seeded PRNG
// ---------------------------------------------------------------------------

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(31, h) + s.charCodeAt(i);
    h |= 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fisherYatesShuffle<T>(arr: T[], seed: number): void {
  const rng = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { argv } = loadScriptTarget();
  const dryRun = hasFlag(argv, "--dry-run");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  const { client } = createWriteBlockingClient(supabaseUrl, supabaseKey);

  console.log("[export] fetching curated products…");
  const products = await selectAllPages<ProductRow>(
    (from, to) =>
      client
        .from("curated_products")
        .select("id, name_zh, product_description_zh, category, subcategory, brand_id")
        .not("category", "is", null)
        .not("subcategory", "is", null)
        .order("created_at", { ascending: true })
        .range(from, to),
    "curated_products",
  );

  if (products.length === 0) {
    console.log("[export] no products with category + subcategory found");
    return;
  }

  console.log(`[export] found ${products.length} products`);

  const systemPrompt = buildSystemPrompt();

  let skipped = 0;
  const entries: Array<{
    id: string;
    userContent: string;
    assistantContent: string;
    category: string;
    subcategory: string;
  }> = [];

  for (const p of products) {
    if (!VALID_L1_SLUGS.has(p.category)) {
      skipped++;
      continue;
    }
    if (!p.subcategory || !VALID_L2_SLUGS.has(p.subcategory)) {
      skipped++;
      continue;
    }

    const userContent = `產品名稱：${p.name_zh}\n描述：${p.product_description_zh ?? "無"}`;
    const assistantContent = JSON.stringify({
      category: p.category,
      subcategory: p.subcategory,
      confidence: "high",
    });

    entries.push({
      id: p.id,
      userContent,
      assistantContent,
      category: p.category,
      subcategory: p.subcategory,
    });
  }

  console.log(
    `[export] ${entries.length} valid entries (${skipped} skipped)`,
  );

  // Stratified 80/20 split by L1 category
  const byCategory = new Map<string, typeof entries>();
  for (const entry of entries) {
    const bucket = byCategory.get(entry.category) ?? [];
    bucket.push(entry);
    byCategory.set(entry.category, bucket);
  }

  const trainSet: TrainingMessage[] = [];
  const evalSet: TrainingMessage[] = [];

  for (const [category, catEntries] of byCategory) {
    const shuffled = [...catEntries];
    fisherYatesShuffle(shuffled, hashSeed("formoria-product-distill-" + category));
    const splitIndex = Math.max(1, Math.floor(shuffled.length * 0.8));

    for (let i = 0; i < shuffled.length; i++) {
      const msg: TrainingMessage = {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: shuffled[i].userContent },
          { role: "assistant", content: shuffled[i].assistantContent },
        ],
      };

      if (i < splitIndex) {
        trainSet.push(msg);
      } else {
        evalSet.push(msg);
      }
    }

    // Count distinct L2s in this category
    const l2s = new Set(catEntries.map((e) => e.subcategory));
    console.log(
      `  ${category}: ${catEntries.length} products (${l2s.size} L2s) → ${Math.min(splitIndex, shuffled.length)} train / ${Math.max(0, shuffled.length - splitIndex)} eval`,
    );
  }

  const stats = {
    totalProducts: products.length,
    validEntries: entries.length,
    skipped,
    trainCount: trainSet.length,
    evalCount: evalSet.length,
    l1Categories: byCategory.size,
    l2Subcategories: new Set(entries.map((e) => e.subcategory)).size,
    categoryBreakdown: Object.fromEntries(
      [...byCategory.entries()].map(([cat, e]) => [cat, e.length]),
    ),
    exportedAt: new Date().toISOString(),
  };

  console.log(`\n[export] train: ${trainSet.length}, eval: ${evalSet.length}`);
  console.log(`[export] L1: ${stats.l1Categories} categories, L2: ${stats.l2Subcategories} subcategories`);

  if (dryRun) {
    console.log("\n[export] --dry-run: stats only, no files written");
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  await mkdir(RUNS_DIR, { recursive: true });

  const trainPath = resolve(RUNS_DIR, "train.jsonl");
  const evalPath = resolve(RUNS_DIR, "eval.jsonl");
  const validPath = resolve(RUNS_DIR, "valid.jsonl");
  const statsPath = resolve(RUNS_DIR, "export-stats.json");

  const evalContent = evalSet.map((m) => JSON.stringify(m)).join("\n") + "\n";

  await writeFile(
    trainPath,
    trainSet.map((m) => JSON.stringify(m)).join("\n") + "\n",
    "utf8",
  );
  await writeFile(evalPath, evalContent, "utf8");
  await writeFile(validPath, evalContent, "utf8");
  await writeFile(statsPath, JSON.stringify(stats, null, 2) + "\n", "utf8");

  console.log(`[export] wrote ${trainPath}`);
  console.log(`[export] wrote ${evalPath}`);
  console.log(`[export] wrote ${validPath} (mlx_lm.lora alias)`);
  console.log(`[export] wrote ${statsPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
