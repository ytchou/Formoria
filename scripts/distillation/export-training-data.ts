/**
 * @formoria-script
 * purpose: Export classification training data from brand_ai_results for distillation.
 * class: operator
 * invoke: pnpm distill:export
 * target: staging-default
 * safety: read-only
 * owner: engineering
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { CATEGORY_LIST } from "@/lib/prompts";
import { L1_CATEGORIES } from "@/lib/taxonomy/ontology";

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

type ClassifyEntry = {
  slug: string;
  reasoning: string;
  category: string;
  confidence: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_L1_SLUGS: Set<string> = new Set(L1_CATEGORIES.map((c) => c.slug));

const RUNS_DIR = resolve(import.meta.dirname, "runs");

const PAGE = 1000;

// ---------------------------------------------------------------------------
// Paginated fetch — PostgREST max_rows silently truncates without .range()
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
// Seeded PRNG — simple mulberry32 from a string hash
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
// Load system prompt
// ---------------------------------------------------------------------------

async function loadSystemPrompt(): Promise<string> {
  const snapshotPath = resolve(
    import.meta.dirname,
    "../../src/lib/prompts/langfuse-snapshot.json",
  );
  const { readFile } = await import("node:fs/promises");
  const raw = await readFile(snapshotPath, "utf8");
  const snapshot = JSON.parse(raw) as {
    prompts: Record<string, { text: string[] }>;
  };
  const prompt = snapshot.prompts["category-classify"];
  if (!prompt) throw new Error("category-classify prompt not found in snapshot");
  const joined = prompt.text.join("\n");
  // Substitute {{category_list}} the same way production does via Langfuse variables
  return joined.replace("{{category_list}}", CATEGORY_LIST);
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

  // Fetch classification results with raw_response (paginated)
  console.log("[export] fetching classification results…");
  const aiRows = await selectAllPages<{
    brand_id: string;
    raw_response: unknown;
    model: string;
  }>(
    (from, to) =>
      client
        .from("brand_ai_results")
        .select("brand_id, raw_response, model")
        .eq("phase", "classification")
        .not("raw_response", "is", null)
        .order("created_at", { ascending: true })
        .range(from, to),
    "brand_ai_results",
  );

  if (aiRows.length === 0) {
    console.log("[export] no classification rows found");
    return;
  }

  console.log(`[export] found ${aiRows.length} classification result rows`);

  // Fetch brand names/descriptions keyed by id
  const brandIds = [...new Set(aiRows.map((r) => r.brand_id))];
  console.log(`[export] fetching ${brandIds.length} brands…`);

  const brandMap = new Map<
    string,
    { slug: string; name: string; description: string | null }
  >();
  const BATCH_SIZE = 500;
  for (let i = 0; i < brandIds.length; i += BATCH_SIZE) {
    const batch = brandIds.slice(i, i + BATCH_SIZE);
    const { data: brands, error: bErr } = await client
      .from("brands")
      .select("id, slug, name, description")
      .in("id", batch);
    if (bErr) throw new Error(`brands query failed: ${bErr.message}`);
    for (const b of brands ?? []) {
      brandMap.set(b.id, {
        slug: b.slug,
        name: b.name,
        description: b.description,
      });
    }
  }

  // Load system prompt
  const systemPrompt = await loadSystemPrompt();

  // Parse all entries
  const allEntries: Array<{
    slug: string;
    userContent: string;
    assistantContent: string;
    category: string;
  }> = [];

  let parseFailures = 0;

  for (const row of aiRows) {
    const brand = brandMap.get(row.brand_id);
    if (!brand) {
      parseFailures++;
      continue;
    }

    let rawResponse: unknown;
    try {
      rawResponse =
        typeof row.raw_response === "string"
          ? JSON.parse(row.raw_response)
          : row.raw_response;
    } catch {
      parseFailures++;
      continue;
    }

    const entries: ClassifyEntry[] = [];
    const parsed = rawResponse as Record<string, unknown>;

    // Batch shape: { results: [...] }
    if (
      parsed &&
      "results" in parsed &&
      Array.isArray((parsed as { results: unknown }).results)
    ) {
      for (const entry of (parsed as { results: ClassifyEntry[] }).results) {
        if (entry.slug === brand.slug) {
          entries.push(entry);
        }
      }
    }
    // Single-brand shape: { reasoning, category, confidence }
    else if (parsed && "category" in parsed && "reasoning" in parsed) {
      entries.push(parsed as unknown as ClassifyEntry);
    }

    for (const entry of entries) {
      if (!entry.category || !VALID_L1_SLUGS.has(entry.category)) {
        parseFailures++;
        continue;
      }

      // Match production behavior: "無" when description is null
      const userContent = `品牌名稱：${brand.name}\n描述：${brand.description ?? "無"}`;
      const assistantContent = JSON.stringify({
        reasoning: entry.reasoning,
        category: entry.category,
        confidence: entry.confidence,
      });

      allEntries.push({
        slug: brand.slug,
        userContent,
        assistantContent,
        category: entry.category,
      });
    }
  }

  console.log(
    `[export] parsed ${allEntries.length} valid entries (${parseFailures} failures)`,
  );

  // Dedup: keep only the latest entry per brand slug (last in array = latest)
  const dedupMap = new Map<string, (typeof allEntries)[number]>();
  for (const entry of allEntries) {
    dedupMap.set(entry.slug, entry);
  }
  const dedupedEntries = [...dedupMap.values()];
  console.log(
    `[export] deduped to ${dedupedEntries.length} entries (from ${allEntries.length})`,
  );

  // Stratified 80/20 split by category
  const byCategory = new Map<string, typeof dedupedEntries>();
  for (const entry of dedupedEntries) {
    const bucket = byCategory.get(entry.category) ?? [];
    bucket.push(entry);
    byCategory.set(entry.category, bucket);
  }

  const trainSet: TrainingMessage[] = [];
  const evalSet: TrainingMessage[] = [];

  for (const [category, entries] of byCategory) {
    // Seeded Fisher-Yates shuffle for reproducibility
    const shuffled = [...entries];
    fisherYatesShuffle(shuffled, hashSeed("formoria-distill-" + category));
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

    console.log(
      `  ${category}: ${entries.length} total → ${Math.min(splitIndex, shuffled.length)} train / ${Math.max(0, shuffled.length - splitIndex)} eval`,
    );
  }

  // Stats
  const stats = {
    totalRawEntries: allEntries.length,
    dedupedEntries: dedupedEntries.length,
    parseFailures,
    trainCount: trainSet.length,
    evalCount: evalSet.length,
    categoryBreakdown: Object.fromEntries(
      [...byCategory.entries()].map(([cat, entries]) => [cat, entries.length]),
    ),
    exportedAt: new Date().toISOString(),
  };

  console.log(`\n[export] train: ${trainSet.length}, eval: ${evalSet.length}`);

  if (dryRun) {
    console.log("\n[export] --dry-run: stats only, no files written");
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  // Write output files
  await mkdir(RUNS_DIR, { recursive: true });

  const trainPath = resolve(RUNS_DIR, "train.jsonl");
  const evalPath = resolve(RUNS_DIR, "eval.jsonl");
  const validPath = resolve(RUNS_DIR, "valid.jsonl"); // mlx_lm.lora expects valid.jsonl
  const statsPath = resolve(RUNS_DIR, "export-stats.json");

  const evalContent =
    evalSet.map((m) => JSON.stringify(m)).join("\n") + "\n";

  await writeFile(
    trainPath,
    trainSet.map((m) => JSON.stringify(m)).join("\n") + "\n",
    "utf8",
  );
  await writeFile(evalPath, evalContent, "utf8");
  await writeFile(validPath, evalContent, "utf8"); // copy for mlx_lm.lora
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
