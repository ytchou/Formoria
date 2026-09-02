/**
 * Per-brand trace export for a curation job — decisions, tool spans, AI results.
 * Outputs per-brand markdown + JSON under docs/dev-1644/traces/<job>/.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createWriteBlockingClient } from "../lib/readonly-client";
import { loadScriptTarget } from "../shared/target";

// ---------------------------------------------------------------------------
// Types — exported for tests
// ---------------------------------------------------------------------------

export type DecisionStep = {
  ms: number;
  phase: string;
  action: string;
  detail: string;
};

export type ToolSpan = {
  spanId: string;
  provider: string;
  ms: number;
  durationMs: number;
  status: number;
  detail: string;
};

// ---------------------------------------------------------------------------
// Pure formatting logic — exported for tests
// ---------------------------------------------------------------------------

type TimelineRow = {
  ms: number;
  phase: string;
  action: string;
  detail: string;
  duration: string;
};

/**
 * Renders a per-brand decision timeline as a markdown table.
 * Decisions and tool spans are merged and sorted by `ms`.
 */
export function renderDecisionTimeline(
  slug: string,
  decisions: DecisionStep[],
  spans: ToolSpan[],
): string {
  const rows: TimelineRow[] = [];

  for (const d of decisions) {
    rows.push({
      ms: d.ms,
      phase: d.phase,
      action: d.action,
      detail: d.detail,
      duration: "",
    });
  }

  for (const s of spans) {
    rows.push({
      ms: s.ms,
      phase: s.provider,
      action: `[${s.spanId}] ${s.detail}`,
      detail: `status=${s.status}`,
      duration: `${s.durationMs}ms`,
    });
  }

  rows.sort((a, b) => a.ms - b.ms);

  const lines: string[] = [];
  lines.push(`## ${slug}\n`);
  lines.push("| ms | phase | action | detail | duration |");
  lines.push("| --- | --- | --- | --- | --- |");

  for (const r of rows) {
    lines.push(
      `| ${r.ms} | ${r.phase} | ${r.action} | ${r.detail} | ${r.duration} |`,
    );
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Database fetch (not tested — integration only)
// ---------------------------------------------------------------------------

async function fetchTraces(
  client: ReturnType<typeof createWriteBlockingClient>["client"],
  jobId: string,
) {
  // Phase results from curation_job_targets
  const { data: targets, error: tErr } = await client
    .from("curation_job_targets")
    .select("brand_id, brand_slug, phase_results")
    .eq("job_id", jobId);

  if (tErr) throw new Error(`curation_job_targets query failed: ${tErr.message}`);

  // External call audit spans
  const { data: auditSpans, error: aErr } = await client
    .from("external_call_audit")
    .select("*")
    .eq("job_id", jobId)
    .in("provider", ["scraper", "browserless", "http", "openai"]);

  if (aErr) throw new Error(`external_call_audit query failed: ${aErr.message}`);

  // AI results for acquisition phase
  const { data: aiResults, error: aiErr } = await client
    .from("brand_ai_results")
    .select("*")
    .eq("phase", "acquisition");

  if (aiErr) throw new Error(`brand_ai_results query failed: ${aiErr.message}`);

  return { targets: targets ?? [], auditSpans: auditSpans ?? [], aiResults: aiResults ?? [] };
}

function extractDecisions(
  phaseResults: Record<string, unknown> | null,
): DecisionStep[] {
  if (!phaseResults) return [];

  const links = phaseResults.links as
    | { plan?: unknown[]; decisions?: unknown[] }
    | undefined;
  if (!links) return [];

  const steps: DecisionStep[] = [];

  if (Array.isArray(links.plan)) {
    for (const entry of links.plan) {
      const e = entry as Record<string, unknown>;
      steps.push({
        ms: (e.ms as number) ?? 0,
        phase: "plan",
        action: String(e.action ?? ""),
        detail: String(e.detail ?? ""),
      });
    }
  }

  if (Array.isArray(links.decisions)) {
    for (const entry of links.decisions) {
      const e = entry as Record<string, unknown>;
      steps.push({
        ms: (e.ms as number) ?? 0,
        phase: "execute",
        action: String(e.action ?? ""),
        detail: String(e.detail ?? ""),
      });
    }
  }

  return steps;
}

function auditToSpans(
  rows: Array<Record<string, unknown>>,
  brandId: string,
): ToolSpan[] {
  return rows
    .filter((r) => r.brand_id === brandId)
    .map((r) => ({
      spanId: String(r.span_id ?? r.id ?? ""),
      provider: String(r.provider ?? ""),
      ms: (r.started_at_ms as number) ?? 0,
      durationMs: (r.duration_ms as number) ?? 0,
      status: (r.status as number) ?? 0,
      detail: String(r.detail ?? r.url ?? ""),
    }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { argv } = loadScriptTarget();

  const jobIdx = argv.indexOf("--job");
  if (jobIdx === -1 || !argv[jobIdx + 1]) {
    throw new Error("Usage: --job <job-id>");
  }
  const jobId = argv[jobIdx + 1];

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env",
    );
  }

  const { client } = createWriteBlockingClient(supabaseUrl, supabaseKey);

  console.log(`[traces] fetching traces for job ${jobId}…`);
  const { targets, auditSpans, aiResults } = await fetchTraces(client, jobId);
  console.log(
    `[traces] ${targets.length} targets, ${auditSpans.length} spans, ${aiResults.length} AI results`,
  );

  const outDir = resolve(`docs/dev-1644/traces/${jobId}`);
  await mkdir(outDir, { recursive: true });

  for (const target of targets) {
    const slug = target.brand_slug as string;
    const brandId = target.brand_id as string;
    const phaseResults = target.phase_results as Record<string, unknown> | null;

    const decisions = extractDecisions(phaseResults);
    const spans = auditToSpans(auditSpans as Array<Record<string, unknown>>, brandId);

    const md = renderDecisionTimeline(slug, decisions, spans);
    await writeFile(resolve(outDir, `${slug}.md`), md + "\n");

    // Also write raw JSON for programmatic analysis
    const json = { slug, brandId, decisions, spans, aiResults: (aiResults as Array<Record<string, unknown>>).filter((r) => r.brand_id === brandId) };
    await writeFile(
      resolve(outDir, `${slug}.json`),
      JSON.stringify(json, null, 2) + "\n",
    );

    console.log(`[traces] wrote ${slug}`);
  }

  console.log(`[traces] done — ${outDir}`);
}

if (process.env.VITEST !== 'true') {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
