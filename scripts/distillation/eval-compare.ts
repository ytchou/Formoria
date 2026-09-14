/** 3-way eval comparison — luna vs Qwen3 foundation vs Qwen3 fine-tuned. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import { L1_CATEGORIES } from "@/lib/taxonomy/ontology";
import {
  categoryAgreement,
  confidenceBandAgreement,
} from "@/lib/services/eval/scorers";

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

function argValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv.at(index + 1);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ArmName = "luna" | "foundation" | "fineTuned";

type ClassifyOutput = {
  reasoning: string;
  category: string;
  confidence: string;
};

type EvalMessage = {
  messages: Array<{ role: string; content: string }>;
};

type ArmResult = {
  category: string | null;
  confidence: string | null;
  reasoning: string | null;
  parseSuccess: boolean;
  latencyMs: number;
  error: string | null;
};

type BrandResult = {
  slug: string;
  expected: ClassifyOutput;
  luna: ArmResult | null;
  foundation: ArmResult | null;
  fineTuned: ArmResult | null;
  scores: Record<string, Record<string, number>>;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RUNS_DIR = resolve(import.meta.dirname, "runs");

const classifyShape = z.object({
  reasoning: z.string(),
  category: z.enum(
    L1_CATEGORIES.map((c) => c.slug) as [string, ...string[]],
  ),
  confidence: z.enum(["high", "medium", "low"]),
});

// ---------------------------------------------------------------------------
// JSON Schema for Ollama structured output
// ---------------------------------------------------------------------------

const OLLAMA_JSON_SCHEMA = {
  type: "object" as const,
  properties: {
    reasoning: { type: "string" as const },
    category: {
      type: "string" as const,
      enum: L1_CATEGORIES.map((c) => c.slug),
    },
    confidence: {
      type: "string" as const,
      enum: ["high", "medium", "low"],
    },
  },
  required: ["reasoning", "category", "confidence"] as const,
};

// ---------------------------------------------------------------------------
// Load system prompt
// ---------------------------------------------------------------------------

async function loadSystemPrompt(): Promise<string> {
  const snapshotPath = resolve(
    import.meta.dirname,
    "../../src/lib/prompts/langfuse-snapshot.json",
  );
  const raw = await readFile(snapshotPath, "utf8");
  const snapshot = JSON.parse(raw) as {
    prompts: Record<string, { text: string[] }>;
  };
  const prompt = snapshot.prompts["category-classify"];
  if (!prompt) throw new Error("category-classify prompt not found in snapshot");
  return prompt.text.join("\n");
}

// ---------------------------------------------------------------------------
// API call helpers
// ---------------------------------------------------------------------------

async function callOpenAI(
  systemPrompt: string,
  userContent: string,
): Promise<ArmResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      category: null,
      confidence: null,
      reasoning: null,
      parseSuccess: false,
      latencyMs: 0,
      error: "OPENAI_API_KEY not set",
    };
  }

  const start = Date.now();
  try {
    const response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-5.6-luna",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          response_format: { type: "json_object" },
        }),
      },
    );
    const latencyMs = Date.now() - start;

    if (!response.ok) {
      const text = await response.text();
      return {
        category: null,
        confidence: null,
        reasoning: null,
        parseSuccess: false,
        latencyMs,
        error: `OpenAI ${response.status}: ${text.slice(0, 200)}`,
      };
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    const content = data.choices[0]?.message?.content ?? "";
    return parseArmResponse(content, latencyMs);
  } catch (err) {
    return {
      category: null,
      confidence: null,
      reasoning: null,
      parseSuccess: false,
      latencyMs: Date.now() - start,
      error: String(err),
    };
  }
}

async function callOllama(
  systemPrompt: string,
  userContent: string,
  model: string,
): Promise<ArmResult> {
  const start = Date.now();
  try {
    const response = await fetch(
      "http://localhost:11434/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          format: OLLAMA_JSON_SCHEMA,
        }),
      },
    );
    const latencyMs = Date.now() - start;

    if (!response.ok) {
      const text = await response.text();
      return {
        category: null,
        confidence: null,
        reasoning: null,
        parseSuccess: false,
        latencyMs,
        error: `Ollama ${response.status}: ${text.slice(0, 200)}`,
      };
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    const content = data.choices[0]?.message?.content ?? "";
    return parseArmResponse(content, latencyMs);
  } catch (err) {
    const message = String(err);
    const isConnectionError =
      message.includes("ECONNREFUSED") || message.includes("fetch failed");
    return {
      category: null,
      confidence: null,
      reasoning: null,
      parseSuccess: false,
      latencyMs: Date.now() - start,
      error: isConnectionError
        ? `Ollama unavailable (${model}): ${message}`
        : message,
    };
  }
}

function parseArmResponse(content: string, latencyMs: number): ArmResult {
  try {
    const parsed = JSON.parse(content);
    const result = classifyShape.safeParse(parsed);
    if (result.success) {
      return {
        category: result.data.category,
        confidence: result.data.confidence,
        reasoning: result.data.reasoning,
        parseSuccess: true,
        latencyMs,
        error: null,
      };
    }
    return {
      category: parsed.category ?? null,
      confidence: parsed.confidence ?? null,
      reasoning: parsed.reasoning ?? null,
      parseSuccess: false,
      latencyMs,
      error: `Schema validation failed`,
    };
  } catch {
    return {
      category: null,
      confidence: null,
      reasoning: null,
      parseSuccess: false,
      latencyMs,
      error: "JSON parse failed",
    };
  }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function scoreArm(
  armResult: ArmResult | null,
  expected: ClassifyOutput,
): Record<string, number> {
  if (!armResult || !armResult.parseSuccess) {
    return { categoryAgreement: 0, confidenceAgreement: 0, exactMatch: 0 };
  }

  return {
    categoryAgreement: categoryAgreement(
      { category: armResult.category ?? "" },
      { category: expected.category },
    ),
    confidenceAgreement: confidenceBandAgreement(
      armResult.confidence ?? undefined,
      expected.confidence,
    ),
    exactMatch: armResult.category === expected.category ? 1 : 0,
  };
}

// ---------------------------------------------------------------------------
// Latency stats
// ---------------------------------------------------------------------------

function latencyStats(values: number[]): {
  p50: number;
  p95: number;
  max: number;
} {
  if (values.length === 0) return { p50: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    max: sorted[sorted.length - 1],
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const armFilter = argValue(argv, "--arm") as ArmName | undefined;

  const activeArms: ArmName[] = armFilter
    ? [armFilter]
    : ["luna", "foundation", "fineTuned"];

  // Load eval dataset
  const evalPath = resolve(RUNS_DIR, "eval.jsonl");
  let evalRaw: string;
  try {
    evalRaw = await readFile(evalPath, "utf8");
  } catch {
    console.error(
      `[eval] eval.jsonl not found at ${evalPath}. Run pnpm distill:export first.`,
    );
    process.exit(1);
  }

  const evalMessages: EvalMessage[] = evalRaw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as EvalMessage);

  console.log(`[eval] loaded ${evalMessages.length} eval samples`);
  console.log(`[eval] active arms: ${activeArms.join(", ")}`);

  // Load system prompt
  const systemPrompt = await loadSystemPrompt();

  // Run evaluation
  const results: BrandResult[] = [];
  const armLatencies: Record<ArmName, number[]> = {
    luna: [],
    foundation: [],
    fineTuned: [],
  };
  const armParseFailures: Record<ArmName, number> = {
    luna: 0,
    foundation: 0,
    fineTuned: 0,
  };

  for (let i = 0; i < evalMessages.length; i++) {
    const msg = evalMessages[i];
    const userMsg = msg.messages.find((m) => m.role === "user");
    const assistantMsg = msg.messages.find((m) => m.role === "assistant");
    if (!userMsg || !assistantMsg) continue;

    const expected = JSON.parse(assistantMsg.content) as ClassifyOutput;
    // Extract slug from user content: "品牌名稱：X\n描述：Y"
    const slugMatch = userMsg.content.match(/品牌名稱：(.+?)(?:\n|$)/);
    const slug = slugMatch?.[1] ?? `sample-${i}`;

    console.log(
      `[eval] ${i + 1}/${evalMessages.length}: ${slug} (expected: ${expected.category})`,
    );

    const brandResult: BrandResult = {
      slug,
      expected,
      luna: null,
      foundation: null,
      fineTuned: null,
      scores: {},
    };

    // Run each active arm
    if (activeArms.includes("luna")) {
      brandResult.luna = await callOpenAI(systemPrompt, userMsg.content);
      armLatencies.luna.push(brandResult.luna.latencyMs);
      if (!brandResult.luna.parseSuccess) armParseFailures.luna++;
      brandResult.scores.luna = scoreArm(brandResult.luna, expected);
    }

    if (activeArms.includes("foundation")) {
      brandResult.foundation = await callOllama(
        systemPrompt,
        userMsg.content,
        "qwen3:1.7b",
      );
      armLatencies.foundation.push(brandResult.foundation.latencyMs);
      if (!brandResult.foundation.parseSuccess) armParseFailures.foundation++;
      brandResult.scores.foundation = scoreArm(
        brandResult.foundation,
        expected,
      );
    }

    if (activeArms.includes("fineTuned")) {
      brandResult.fineTuned = await callOllama(
        systemPrompt,
        userMsg.content,
        "formoria-classifier",
      );
      armLatencies.fineTuned.push(brandResult.fineTuned.latencyMs);
      if (!brandResult.fineTuned.parseSuccess) armParseFailures.fineTuned++;
      brandResult.scores.fineTuned = scoreArm(
        brandResult.fineTuned,
        expected,
      );
    }

    results.push(brandResult);
  }

  // Compute aggregates
  const aggregate: Record<
    string,
    {
      accuracy: number;
      categoryAgreement: number;
      confidenceAgreement: number;
      parseFailures: number;
      total: number;
      latency: { p50: number; p95: number; max: number };
    }
  > = {};

  for (const arm of activeArms) {
    const armScores = results
      .map((r) => r.scores[arm])
      .filter((s): s is Record<string, number> => s !== undefined);

    const total = armScores.length;
    const accuracy =
      total > 0
        ? armScores.reduce((sum, s) => sum + s.exactMatch, 0) / total
        : 0;
    const catAg =
      total > 0
        ? armScores.reduce((sum, s) => sum + s.categoryAgreement, 0) / total
        : 0;
    const confAg =
      total > 0
        ? armScores.reduce((sum, s) => sum + s.confidenceAgreement, 0) / total
        : 0;

    aggregate[arm] = {
      accuracy: Math.round(accuracy * 1000) / 1000,
      categoryAgreement: Math.round(catAg * 1000) / 1000,
      confidenceAgreement: Math.round(confAg * 1000) / 1000,
      parseFailures: armParseFailures[arm],
      total,
      latency: latencyStats(armLatencies[arm]),
    };
  }

  // Per-category breakdown
  const categoryBreakdown: Record<
    string,
    Record<string, { correct: number; total: number; accuracy: number }>
  > = {};

  for (const arm of activeArms) {
    categoryBreakdown[arm] = {};
    for (const result of results) {
      const cat = result.expected.category;
      if (!categoryBreakdown[arm][cat]) {
        categoryBreakdown[arm][cat] = { correct: 0, total: 0, accuracy: 0 };
      }
      categoryBreakdown[arm][cat].total++;
      const armScore = result.scores[arm];
      if (armScore?.exactMatch === 1) {
        categoryBreakdown[arm][cat].correct++;
      }
    }
    for (const cat of Object.keys(categoryBreakdown[arm])) {
      const entry = categoryBreakdown[arm][cat];
      entry.accuracy =
        entry.total > 0
          ? Math.round((entry.correct / entry.total) * 1000) / 1000
          : 0;
    }
  }

  // Summary table for article
  const summaryTable = activeArms.map((arm) => ({
    arm,
    accuracy: aggregate[arm]?.accuracy ?? 0,
    categoryAgreement: aggregate[arm]?.categoryAgreement ?? 0,
    confidenceAgreement: aggregate[arm]?.confidenceAgreement ?? 0,
    parseFailures: armParseFailures[arm],
    p50Ms: aggregate[arm]?.latency.p50 ?? 0,
    p95Ms: aggregate[arm]?.latency.p95 ?? 0,
  }));

  const output = {
    evalCount: evalMessages.length,
    activeArms,
    aggregate,
    categoryBreakdown,
    summaryTable,
    results,
    exportedAt: new Date().toISOString(),
  };

  // Print summary
  console.log("\n--- Summary ---");
  for (const arm of activeArms) {
    const a = aggregate[arm];
    if (!a) continue;
    console.log(
      `  ${arm}: accuracy=${a.accuracy} catAg=${a.categoryAgreement} confAg=${a.confidenceAgreement} parseFail=${a.parseFailures} p50=${a.latency.p50}ms p95=${a.latency.p95}ms`,
    );
  }

  // Write results
  await mkdir(RUNS_DIR, { recursive: true });
  const outputPath = resolve(RUNS_DIR, "eval-results.json");
  await writeFile(outputPath, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(`\n[eval] wrote ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
