/** Eval comparison — luna vs Qwen3-0.6B foundation vs Qwen3-0.6B fine-tuned, plus
 * the opt-in TypeSafe Jev arm (`--arm jev`, DEV-1824).
 * Scores both L1 (category) and L2 (subcategory) accuracy. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import { L1_CATEGORIES, L2_SUBCATEGORIES } from "@/lib/taxonomy/ontology";

import { loadScriptTarget } from "../shared/target";

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

type ArmName = "luna" | "foundation" | "fineTuned" | "jev";

const VALID_ARM_NAMES: ReadonlySet<string> = new Set([
  "luna",
  "foundation",
  "fineTuned",
  "finetuned",
  "jev",
]);

function normalizeArm(raw: string): ArmName {
  if (raw === "finetuned") return "fineTuned";
  return raw as ArmName;
}

type ClassifyOutput = {
  category: string;
  subcategory: string;
  confidence: string;
};

type EvalMessage = {
  messages: Array<{ role: string; content: string }>;
};

type ArmResult = {
  category: string | null;
  subcategory: string | null;
  confidence: string | null;
  parseSuccess: boolean;
  latencyMs: number;
  error: string | null;
};

type ProductResult = {
  name: string;
  expected: ClassifyOutput;
  luna: ArmResult | null;
  foundation: ArmResult | null;
  fineTuned: ArmResult | null;
  jev: ArmResult | null;
  scores: Record<string, Record<string, number>>;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RUNS_DIR = resolve(import.meta.dirname, "runs");

const L1_SLUGS = L1_CATEGORIES.map((c) => c.slug) as [string, ...string[]];
const L2_SLUGS = L2_SUBCATEGORIES.map((s) => s.slug) as [string, ...string[]];

const classifyShape = z.object({
  category: z.enum(L1_SLUGS),
  subcategory: z.enum(L2_SLUGS),
  confidence: z.enum(["high", "medium", "low"]),
});

const OLLAMA_JSON_SCHEMA = {
  type: "object" as const,
  properties: {
    category: { type: "string" as const, enum: L1_SLUGS },
    subcategory: { type: "string" as const, enum: L2_SLUGS },
    confidence: { type: "string" as const, enum: ["high", "medium", "low"] },
  },
  required: ["category", "subcategory", "confidence"] as const,
};

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
      subcategory: null,
      confidence: null,
      parseSuccess: false,
      latencyMs: 0,
      error: "OPENAI_API_KEY not set",
    };
  }

  const model = "gpt-5.6-luna";
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
          model,
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
      console.log(
        `[audit] OpenAI ${model} status=${response.status} latency=${latencyMs}ms error=${text.slice(0, 120)}`,
      );
      return {
        category: null,
        subcategory: null,
        confidence: null,
        parseSuccess: false,
        latencyMs,
        error: `OpenAI ${response.status}: ${text.slice(0, 200)}`,
      };
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    const content = data.choices[0]?.message?.content ?? "";
    console.log(
      `[audit] OpenAI ${model} status=${response.status} latency=${latencyMs}ms responseLen=${content.length}`,
    );
    return parseArmResponse(content, latencyMs);
  } catch (err) {
    const latencyMs = Date.now() - start;
    return {
      category: null,
      subcategory: null,
      confidence: null,
      parseSuccess: false,
      latencyMs,
      error: String(err),
    };
  }
}

async function callOllama(
  systemPrompt: string,
  userContent: string,
  model: string,
  port = 11434,
): Promise<ArmResult> {
  const start = Date.now();
  try {
    const response = await fetch(`http://localhost:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        format: OLLAMA_JSON_SCHEMA,
        stream: false,
      }),
    });
    const latencyMs = Date.now() - start;

    if (!response.ok) {
      const text = await response.text();
      return {
        category: null,
        subcategory: null,
        confidence: null,
        parseSuccess: false,
        latencyMs,
        error: `Ollama ${response.status}: ${text.slice(0, 200)}`,
      };
    }

    const data = (await response.json()) as {
      message: { content: string };
    };
    const content = data.message?.content ?? "";
    return parseArmResponse(content, latencyMs);
  } catch (err) {
    const message = String(err);
    const isConnectionError =
      message.includes("ECONNREFUSED") || message.includes("fetch failed");
    return {
      category: null,
      subcategory: null,
      confidence: null,
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
        subcategory: result.data.subcategory,
        confidence: result.data.confidence,
        parseSuccess: true,
        latencyMs,
        error: null,
      };
    }
    return {
      category: parsed.category ?? null,
      subcategory: parsed.subcategory ?? null,
      confidence: parsed.confidence ?? null,
      parseSuccess: false,
      latencyMs,
      error: "Schema validation failed",
    };
  } catch {
    return {
      category: null,
      subcategory: null,
      confidence: null,
      parseSuccess: false,
      latencyMs,
      error: "JSON parse failed",
    };
  }
}

/** Jev answers are typed, so there is no parse step; `confidence` records the joint probability. */
async function callJev(userContent: string): Promise<ArmResult> {
  const start = Date.now();
  try {
    const [{ decide }, { JEV_CANDIDATES }] = await Promise.all([
      import("@/lib/services/typesafe-audit"),
      import("@/lib/services/eval/jev-questions"),
    ]);
    const run = await JEV_CANDIDATES.productCategory.run(
      (profileKey, state, questions) => decide(profileKey, state, questions),
      userContent,
    );
    console.log(
      `[audit] Jev productCategory latency=${run.latencyMs}ms costUsd=${run.costUsd ?? "unknown"}`,
    );
    return {
      category: run.output.category,
      subcategory: run.output.subcategory,
      confidence: String(run.output.probability),
      parseSuccess: true,
      latencyMs: run.latencyMs,
      error: null,
    };
  } catch (err) {
    return {
      category: null,
      subcategory: null,
      confidence: null,
      parseSuccess: false,
      latencyMs: Date.now() - start,
      error: String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Scoring — L1, L2, and combined
// ---------------------------------------------------------------------------

function scoreArm(
  armResult: ArmResult | null,
  expected: ClassifyOutput,
): Record<string, number> {
  if (!armResult || !armResult.parseSuccess) {
    return { l1Match: 0, l2Match: 0, bothMatch: 0 };
  }

  const l1 = armResult.category === expected.category ? 1 : 0;
  const l2 = armResult.subcategory === expected.subcategory ? 1 : 0;
  return {
    l1Match: l1,
    l2Match: l2,
    bothMatch: l1 && l2 ? 1 : 0,
  };
}

// ---------------------------------------------------------------------------
// Latency stats
// ---------------------------------------------------------------------------

function latencyStats(values: number[]) {
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
  const { argv } = loadScriptTarget();

  // Eval runs must not write external_call_audit rows: collect nothing, restore after.
  const { setAuditWriteSeam } = await import("@/lib/audit");
  setAuditWriteSeam(async () => null);
  try {
    await runEval(argv);
  } finally {
    setAuditWriteSeam(null);
  }
}

async function runEval(argv: string[]) {
  const rawArm = argValue(argv, "--arm");
  if (rawArm !== undefined && !VALID_ARM_NAMES.has(rawArm)) {
    console.error(
      `[eval] invalid --arm "${rawArm}". Valid: luna, foundation, fineTuned, jev`,
    );
    process.exit(1);
  }
  const armFilter: ArmName | undefined =
    rawArm !== undefined ? normalizeArm(rawArm) : undefined;
  const activeArms: ArmName[] = armFilter
    ? [armFilter]
    : ["luna", "foundation", "fineTuned"];

  const evalPath = resolve(RUNS_DIR, "eval.jsonl");
  let evalRaw: string;
  try {
    evalRaw = await readFile(evalPath, "utf8");
  } catch {
    console.error(
      `[eval] eval.jsonl not found. Run pnpm distill:export first.`,
    );
    process.exit(1);
  }

  if (!evalRaw.trim()) {
    console.error("eval.jsonl is empty. Run pnpm distill:export first.");
    process.exit(1);
  }

  const evalMessages: EvalMessage[] = evalRaw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as EvalMessage);

  console.log(`[eval] loaded ${evalMessages.length} eval samples`);
  console.log(`[eval] active arms: ${activeArms.join(", ")}`);

  // Use the system prompt from the training data (first eval row)
  const systemPrompt =
    evalMessages[0].messages.find((m) => m.role === "system")?.content ?? "";

  const results: ProductResult[] = [];
  const armLatencies: Record<ArmName, number[]> = {
    luna: [],
    foundation: [],
    fineTuned: [],
    jev: [],
  };
  const armParseFailures: Record<ArmName, number> = {
    luna: 0,
    foundation: 0,
    fineTuned: 0,
    jev: 0,
  };

  for (let i = 0; i < evalMessages.length; i++) {
    const msg = evalMessages[i];
    const userMsg = msg.messages.find((m) => m.role === "user");
    const assistantMsg = msg.messages.find((m) => m.role === "assistant");
    if (!userMsg || !assistantMsg) continue;

    let expected: ClassifyOutput;
    try {
      expected = JSON.parse(assistantMsg.content) as ClassifyOutput;
    } catch {
      console.warn(`[eval] skipping sample ${i}: bad expected output`);
      continue;
    }

    const nameMatch = userMsg.content.match(/產品名稱：(.+?)(?:\n|$)/);
    const name = nameMatch?.[1] ?? `sample-${i}`;

    console.log(
      `[eval] ${i + 1}/${evalMessages.length}: ${name} (expected: ${expected.category}/${expected.subcategory})`,
    );

    const productResult: ProductResult = {
      name,
      expected,
      luna: null,
      foundation: null,
      fineTuned: null,
      jev: null,
      scores: {},
    };

    if (activeArms.includes("luna")) {
      productResult.luna = await callOpenAI(systemPrompt, userMsg.content);
      armLatencies.luna.push(productResult.luna.latencyMs);
      if (!productResult.luna.parseSuccess) armParseFailures.luna++;
      productResult.scores.luna = scoreArm(productResult.luna, expected);
    }

    if (activeArms.includes("foundation")) {
      // Foundation served via mlx-serve.py on port 11435 (same as fine-tuned, swap model between runs)
      productResult.foundation = await callOllama(
        systemPrompt,
        userMsg.content,
        "qwen3-0.6b",
        11435,
      );
      armLatencies.foundation.push(productResult.foundation.latencyMs);
      if (!productResult.foundation.parseSuccess)
        armParseFailures.foundation++;
      productResult.scores.foundation = scoreArm(
        productResult.foundation,
        expected,
      );
    }

    if (activeArms.includes("fineTuned")) {
      productResult.fineTuned = await callOllama(
        systemPrompt,
        userMsg.content,
        "formoria-classifier",
        11435,
      );
      armLatencies.fineTuned.push(productResult.fineTuned.latencyMs);
      if (!productResult.fineTuned.parseSuccess)
        armParseFailures.fineTuned++;
      productResult.scores.fineTuned = scoreArm(
        productResult.fineTuned,
        expected,
      );
    }

    if (activeArms.includes("jev")) {
      productResult.jev = await callJev(userMsg.content);
      armLatencies.jev.push(productResult.jev.latencyMs);
      if (!productResult.jev.parseSuccess) armParseFailures.jev++;
      productResult.scores.jev = scoreArm(productResult.jev, expected);
    }

    results.push(productResult);
  }

  // Aggregates
  const aggregate: Record<string, Record<string, unknown>> = {};
  for (const arm of activeArms) {
    const scores = results
      .map((r) => r.scores[arm])
      .filter((s): s is Record<string, number> => s !== undefined);
    const total = scores.length;
    const l1Acc =
      total > 0 ? scores.reduce((s, x) => s + x.l1Match, 0) / total : 0;
    const l2Acc =
      total > 0 ? scores.reduce((s, x) => s + x.l2Match, 0) / total : 0;
    const bothAcc =
      total > 0 ? scores.reduce((s, x) => s + x.bothMatch, 0) / total : 0;

    aggregate[arm] = {
      l1Accuracy: Math.round(l1Acc * 1000) / 1000,
      l2Accuracy: Math.round(l2Acc * 1000) / 1000,
      bothAccuracy: Math.round(bothAcc * 1000) / 1000,
      parseFailures: armParseFailures[arm],
      total,
      latency: latencyStats(armLatencies[arm]),
    };
  }

  // Per-L1-category breakdown
  const l1Breakdown: Record<
    string,
    Record<string, { correct: number; total: number; accuracy: number }>
  > = {};
  for (const arm of activeArms) {
    l1Breakdown[arm] = {};
    for (const result of results) {
      const cat = result.expected.category;
      if (!l1Breakdown[arm][cat])
        l1Breakdown[arm][cat] = { correct: 0, total: 0, accuracy: 0 };
      l1Breakdown[arm][cat].total++;
      if (result.scores[arm]?.l1Match === 1)
        l1Breakdown[arm][cat].correct++;
    }
    for (const cat of Object.keys(l1Breakdown[arm])) {
      const e = l1Breakdown[arm][cat];
      e.accuracy = e.total > 0 ? Math.round((e.correct / e.total) * 1000) / 1000 : 0;
    }
  }

  const output = {
    evalCount: evalMessages.length,
    activeArms,
    aggregate,
    l1Breakdown,
    results,
    exportedAt: new Date().toISOString(),
  };

  console.log("\n--- Summary ---");
  for (const arm of activeArms) {
    const a = aggregate[arm] as Record<string, unknown>;
    const lat = a.latency as { p50: number; p95: number };
    console.log(
      `  ${arm}: L1=${a.l1Accuracy} L2=${a.l2Accuracy} both=${a.bothAccuracy} parseFail=${a.parseFailures} p50=${lat.p50}ms p95=${lat.p95}ms`,
    );
  }

  await mkdir(RUNS_DIR, { recursive: true });
  const outputPath = resolve(RUNS_DIR, "eval-results.json");
  await writeFile(outputPath, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(`\n[eval] wrote ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
