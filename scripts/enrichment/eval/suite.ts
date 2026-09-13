/**
 * @formoria-script
 * purpose: Eval suite orchestrator — spawn refresh, classify, report per cohort.
 * class: operator
 * invoke: pnpm curation:eval
 * target: staging-default
 * safety: writes-on-apply
 * owner: engineering
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { PriceRow } from "@/lib/services/llm-pricing";

import { createWriteBlockingClient } from "../../lib/readonly-client";
import { loadScriptTarget } from "../../shared/target";
import { snapshotDir } from "../run/cohort";
import { classify } from "./classify";
import { type EvalManifest, loadEvalManifest } from "./manifest";
import { assertCensusTarget } from "./production-guard";
import { type BrandRow, aggregate, resolveVerdict } from "./report";
import { summarizeTurns } from "./trace-summary";

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

function argValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv.at(index + 1);
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

// ---------------------------------------------------------------------------
// --report-job implementation
// ---------------------------------------------------------------------------

type ApplyOutcome = {
  applied?: Array<{ slug: string; ok: boolean; detail: string }>;
  rejected?: Array<{ slug: string; reason: string }>;
};

async function reportJob(
  argv: string[],
  manifest: EvalManifest,
) {
  const jobId = argValue(argv, "--report-job");
  if (!jobId) throw new Error("--report-job requires a job id");

  const refreshLogPath = argValue(argv, "--refresh-log");

  // Read-only client for data fetch
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env",
    );
  }

  const { client } = createWriteBlockingClient(supabaseUrl, supabaseKey);

  // Fetch curation_job_targets
  console.log(`[eval] fetching targets for job ${jobId}…`);
  const { data: targets, error: tErr } = await client
    .from("curation_job_targets")
    .select(
      "brand_slug, status, error, phase_results, duration_ms, target_id, target_type",
    )
    .eq("job_id", jobId);
  if (tErr)
    throw new Error(`curation_job_targets query failed: ${tErr.message}`);

  // Fetch brand_ai_results
  const { data: aiResults, error: aiErr } = await client
    .from("brand_ai_results")
    .select(
      "model, phase, prompt_tokens, completion_tokens, cached_prompt_tokens, cost_usd, raw_response, created_at, brand_id, submission_id",
    )
    .eq("job_id", jobId)
    .limit(5000);
  if (aiErr)
    throw new Error(`brand_ai_results query failed: ${aiErr.message}`);

  // Fetch llm_model_prices
  const { data: prices, error: pErr } = await client
    .from("llm_model_prices")
    .select(
      "model, input_per_m, cached_input_per_m, output_per_m, effective_from",
    )
    .order("effective_from", { ascending: false });
  if (pErr)
    throw new Error(`llm_model_prices query failed: ${pErr.message}`);

  // Fetch brand_search_results (reserved for future per-brand search counts)
  const { data: _searches, error: sErr } = await client
    .from("brand_search_results")
    .select("brand_id, submission_id, search_type")
    .eq("job_id", jobId)
    .limit(5000);
  if (sErr)
    throw new Error(`brand_search_results query failed: ${sErr.message}`);

  // Optionally load refresh log for apply outcomes
  let applyOutcomes: Map<string, ApplyOutcome> = new Map();
  if (refreshLogPath) {
    try {
      const logRaw = await readFile(resolve(refreshLogPath), "utf8");
      const parsed = JSON.parse(logRaw) as Record<string, ApplyOutcome>;
      applyOutcomes = new Map(Object.entries(parsed));
    } catch (err) {
      console.warn(
        `[eval] warning: could not load refresh log from ${refreshLogPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Index targets by slug — fallback from submission_id → brands when brand_slug is null
  type TargetRow = {
    brand_slug: string | null;
    status: string;
    error: string | null;
    phase_results: unknown;
    duration_ms: number | null;
    target_id: string;
    target_type: string;
  };
  const targetsBySlug = new Map<string, TargetRow>();
  const unresolvedTargets: TargetRow[] = [];
  for (const t of (targets ?? []) as TargetRow[]) {
    if (t.brand_slug) {
      targetsBySlug.set(t.brand_slug, t);
    } else {
      unresolvedTargets.push(t);
    }
  }

  if (unresolvedTargets.length > 0) {
    const submissionIds = unresolvedTargets
      .filter((t) => t.target_type === "submission")
      .map((t) => t.target_id);
    if (submissionIds.length > 0) {
      const { data: submissions } = await client
        .from("brand_submissions")
        .select("id, brand_id")
        .in("id", submissionIds);
      const brandIds = (submissions ?? [])
        .map((s: { brand_id: string }) => s.brand_id)
        .filter(Boolean);
      if (brandIds.length > 0) {
        const { data: brands } = await client
          .from("brands")
          .select("id, slug")
          .in("id", brandIds);
        const brandMap = new Map(
          (brands ?? []).map((b: { id: string; slug: string }) => [b.id, b.slug]),
        );
        const subMap = new Map(
          (submissions ?? []).map((s: { id: string; brand_id: string }) => [
            s.id,
            s.brand_id,
          ]),
        );
        for (const t of unresolvedTargets) {
          const brandId = subMap.get(t.target_id);
          const slug = brandId ? brandMap.get(brandId) : undefined;
          if (slug) targetsBySlug.set(slug, t);
        }
      }
    }
    console.log(
      `[eval] resolved ${unresolvedTargets.length} target(s) with null brand_slug via submission lookup`,
    );
  }

  // Build brand rows
  const brandRows: BrandRow[] = [];

  for (const slug of manifest.slugs) {
    const evalEntry = manifest.eval[slug];
    const target = targetsBySlug.get(slug);

    // Classify
    const classifyResult = classify({
      targetRow: target
        ? {
            status: target.status,
            error: target.error ?? undefined,
            phase_results: target.phase_results,
          }
        : null,
      applyOutcome: applyOutcomes.get(slug),
    });

    // Resolve verdict
    const { verdict } = resolveVerdict(
      evalEntry.expected as "success_products" | "correct_zero" | "data_defect" | null,
      classifyResult.observed,
    );

    // Summarize LLM turns for this brand
    const brandAiTurns = (aiResults ?? []).filter(
      (r: Record<string, unknown>) =>
        // Match by target_id via submission_id
        target && (r.submission_id === target.target_id || r.brand_id === target.target_id),
    );
    const turnTotals = summarizeTurns(
      brandAiTurns.map((r: Record<string, unknown>) => ({
        model: (r.model as string) ?? null,
        phase: r.phase as string | null,
        prompt_tokens: r.prompt_tokens as number | null,
        completion_tokens: r.completion_tokens as number | null,
        cached_prompt_tokens: r.cached_prompt_tokens as number | null,
        cost_usd: r.cost_usd as number | null,
        raw_response: r.raw_response,
        created_at: r.created_at as string,
      })),
      (prices ?? []) as PriceRow[],
    );

    // Products verification
    const productsPhase = target?.phase_results
      ? (Array.isArray(target.phase_results)
          ? (target.phase_results as Array<Record<string, unknown>>).find(
              (p) => p.phase === "products",
            )
          : undefined)
      : undefined;
    const verification = productsPhase?.productsVerification as
      | Record<string, unknown>
      | undefined;
    const dropReasons = verification?.dropReasons as
      | Record<string, number>
      | undefined;

    brandRows.push({
      slug,
      group: evalEntry.group,
      tags: evalEntry.tags,
      expected: evalEntry.expected,
      observed: classifyResult.observed,
      verdict,
      stage: classifyResult.stage,
      evidence: classifyResult.evidence,
      products: {
        proposed: (verification?.proposed as number) ?? 0,
        verified: (verification?.verified as number) ?? 0,
        repaired: (verification?.repaired as number) ?? 0,
        dropped: (verification?.dropped as number) ?? 0,
        dropReasons: dropReasons ? Object.keys(dropReasons) : [],
      },
      llm: {
        calls: turnTotals.turns,
        promptTokens: turnTotals.promptTokens,
        completionTokens: turnTotals.completionTokens,
        costUsd: turnTotals.costUsd,
        unpricedTurns: turnTotals.unpricedTurns,
      },
      durationMs: target?.duration_ms ?? 0,
      phaseDurations: {},
    });
  }

  // Aggregate
  const agg = aggregate(brandRows);

  // Print summary table
  console.log("\n=== Eval Report ===");
  console.log(`Job: ${jobId}`);
  console.log(`Cohort: ${manifest.name}`);
  console.log(`Attempted: ${agg.attempted}`);
  console.log(
    `Correct outcome rate: ${(agg.correctOutcomeRate * 100).toFixed(1)}%`,
  );
  console.log(
    `Success rate (expected success): ${(agg.successRateOnExpectedSuccess * 100).toFixed(1)}%`,
  );
  console.log(
    `Correct zero rate: ${(agg.correctZeroRate * 100).toFixed(1)}%`,
  );
  console.log(
    `Data defect rate: ${(agg.dataDefectRate * 100).toFixed(1)}%`,
  );
  console.log(`Regressions: ${agg.regressions.join(", ") || "none"}`);
  console.log(`Improvements: ${agg.improvements.join(", ") || "none"}`);
  console.log(
    `Cost: $${agg.cost.total.toFixed(4)} total, $${agg.cost.perAttempted.toFixed(4)}/brand`,
  );
  console.log(
    `Latency: p50=${agg.latencyMs.p50.toFixed(0)}ms p95=${agg.latencyMs.p95.toFixed(0)}ms max=${agg.latencyMs.max.toFixed(0)}ms`,
  );
  console.log(`Transient retries: ${agg.transientRetries}`);

  console.log("\nPer-brand:");
  for (const row of brandRows) {
    const mark =
      row.verdict === "correct"
        ? "  "
        : row.verdict === "regression"
          ? "!!"
          : row.verdict === "improvement"
            ? "++"
            : "??";
    console.log(
      `  ${mark} ${row.slug}: expected=${row.expected ?? "null"} observed=${row.observed} verdict=${row.verdict}`,
    );
  }

  // Write snapshot
  const dir = snapshotDir({
    name: manifest.name,
    title: manifest.title,
    subtitle: manifest.subtitle,
    slugs: manifest.slugs,
    labels: manifest.labels,
  });
  await mkdir(dir, { recursive: true });
  const outPath = resolve(dir, `eval-run-${jobId}.json`);
  await writeFile(
    outPath,
    JSON.stringify({ jobId, manifest: manifest.name, aggregate: agg, brands: brandRows }, null, 2) + "\n",
  );
  console.log(`\n[eval] wrote ${outPath}`);

  // Exit 1 on any regression
  if (agg.regressions.length > 0) {
    console.error(
      `\n[eval] FAIL: ${agg.regressions.length} regression(s): ${agg.regressions.join(", ")}`,
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { target, argv } = loadScriptTarget();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  assertCensusTarget({
    supabaseUrl,
    target,
    confirmed: hasFlag(argv, "--confirm"),
  });

  const cohortRef = argValue(argv, "--cohort") ?? "dev-1689-eval";
  const manifest = await loadEvalManifest(cohortRef);
  console.log(
    `[eval] loaded manifest: ${manifest.name} (${manifest.slugs.length} slugs)`,
  );

  if (hasFlag(argv, "--report-job")) {
    await reportJob(argv, manifest);
    return;
  }

  // Full spawn path — not yet implemented
  console.error(
    "[eval] the full spawn path is not yet implemented. Use --report-job <id> to classify an existing job.",
  );
  process.exit(1);
}

if (process.env.VITEST !== "true") {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
