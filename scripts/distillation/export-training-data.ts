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
  return prompt.text.join("\n");
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

  // Fetch classification results with raw_response
  console.log("[export] fetching classification results…");
  const { data: aiRows, error: aiErr } = await client
    .from("brand_ai_results")
    .select("brand_slug, raw_response, model")
    .eq("phase", "classification")
    .not("raw_response", "is", null);

  if (aiErr) throw new Error(`brand_ai_results query failed: ${aiErr.message}`);
  if (!aiRows || aiRows.length === 0) {
    console.log("[export] no classification rows found");
    return;
  }

  console.log(`[export] found ${aiRows.length} classification result rows`);

  // Fetch brand names/descriptions for user content reconstruction
  const slugs = [...new Set(aiRows.map((r) => r.brand_slug))];
  console.log(`[export] fetching ${slugs.length} brands…`);

  // Supabase .in() has a limit, batch if needed
  const brandMap = new Map<string, { name: string; description: string | null }>();
  const BATCH_SIZE = 500;
  for (let i = 0; i < slugs.length; i += BATCH_SIZE) {
    const batch = slugs.slice(i, i + BATCH_SIZE);
    const { data: brands, error: bErr } = await client
      .from("brands")
      .select("slug, name, description")
      .in("slug", batch);
    if (bErr) throw new Error(`brands query failed: ${bErr.message}`);
    for (const b of brands ?? []) {
      brandMap.set(b.slug, { name: b.name, description: b.description });
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
    const brand = brandMap.get(row.brand_slug);
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
        if (entry.slug === row.brand_slug) {
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

      const userContent = `品牌名稱：${brand.name}\n描述：${brand.description ?? ""}`;
      const assistantContent = JSON.stringify({
        reasoning: entry.reasoning,
        category: entry.category,
        confidence: entry.confidence,
      });

      allEntries.push({
        slug: row.brand_slug,
        userContent,
        assistantContent,
        category: entry.category,
      });
    }
  }

  console.log(
    `[export] parsed ${allEntries.length} valid entries (${parseFailures} failures)`,
  );

  // Stratified 80/20 split by category
  const byCategory = new Map<string, typeof allEntries>();
  for (const entry of allEntries) {
    const bucket = byCategory.get(entry.category) ?? [];
    bucket.push(entry);
    byCategory.set(entry.category, bucket);
  }

  const trainSet: TrainingMessage[] = [];
  const evalSet: TrainingMessage[] = [];

  for (const [category, entries] of byCategory) {
    // Shuffle for randomness
    const shuffled = [...entries].sort(() => Math.random() - 0.5);
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
    totalEntries: allEntries.length,
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
  const statsPath = resolve(RUNS_DIR, "export-stats.json");

  await writeFile(
    trainPath,
    trainSet.map((m) => JSON.stringify(m)).join("\n") + "\n",
    "utf8",
  );
  await writeFile(
    evalPath,
    evalSet.map((m) => JSON.stringify(m)).join("\n") + "\n",
    "utf8",
  );
  await writeFile(statsPath, JSON.stringify(stats, null, 2) + "\n", "utf8");

  console.log(`[export] wrote ${trainPath}`);
  console.log(`[export] wrote ${evalPath}`);
  console.log(`[export] wrote ${statsPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
