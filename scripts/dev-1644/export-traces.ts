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
//
// Join keys: the refresh flow targets submissions, so every per-attempt store
// is keyed by (job_id, submission_id). `external_call_audit.job_id` is null for
// spans nested inside a brand's phase, so it is NOT used as the join key here;
// `brand_search_results` (one row per scrape attempt, `audit_span_id` set) and
// `brand_ai_results` (one row per model turn) are the authoritative stores.
// ---------------------------------------------------------------------------

type TargetRow = {
  target_type: string
  target_id: string
  brand_name: string | null
  brand_slug: string | null
  status: string
  phase_results: unknown
}

type ScrapeRow = {
  submission_id: string | null
  brand_id: string | null
  audit_span_id: string | null
  provider: string | null
  endpoint: string | null
  call_status: string | null
  http_status: number | null
  latency_ms: number | null
  created_at: string
}

type AiRow = {
  submission_id: string | null
  brand_id: string | null
  audit_span_id: string | null
  model: string | null
  latency_ms: number | null
  /** persistAuditEvent stores token usage under raw_response.usage. */
  raw_response: { usage?: { prompt_tokens?: number; completion_tokens?: number } } | null
  created_at: string
}

async function fetchTraces(
  client: ReturnType<typeof createWriteBlockingClient>["client"],
  jobId: string,
) {
  const { data: targets, error: tErr } = await client
    .from("curation_job_targets")
    .select("target_type, target_id, brand_name, brand_slug, status, phase_results")
    .eq("job_id", jobId);
  if (tErr) throw new Error(`curation_job_targets query failed: ${tErr.message}`);

  const { data: scrapes, error: sErr } = await client
    .from("brand_search_results")
    .select("submission_id, brand_id, audit_span_id, provider, endpoint, call_status, http_status, latency_ms, created_at")
    .eq("job_id", jobId)
    .in("provider", ["scraper", "browserless", "http"])
    .limit(1000);
  if (sErr) throw new Error(`brand_search_results query failed: ${sErr.message}`);

  const { data: aiResults, error: aiErr } = await client
    .from("brand_ai_results")
    .select("submission_id, brand_id, audit_span_id, model, latency_ms, raw_response, created_at")
    .eq("job_id", jobId)
    .eq("phase", "acquisition")
    .limit(1000);
  if (aiErr) throw new Error(`brand_ai_results query failed: ${aiErr.message}`);

  return {
    targets: (targets ?? []) as TargetRow[],
    scrapes: (scrapes ?? []) as ScrapeRow[],
    aiResults: (aiResults ?? []) as AiRow[],
  };
}

type LinksPhaseRow = {
  phase: string
  status: string
  agentOutcome?: string
  acquisitionPlan?: {
    surfaces?: Array<{ url: string; fetch: string; strategy?: string; reason: string }>
    fanOut?: string[]
    decisions?: Array<{ step: string; action: string; reason: string; ms: number }>
    /** Runtime decision trace from the graph (gather/plan/execute/critique/finalize). */
    trace?: Array<{ step: string; action: string; reason: string; ms: number }>
    budget?: { allowed: Record<string, number>; used: Record<string, number> }
    error?: string
  }
}

function linksPhase(phaseResults: unknown): LinksPhaseRow | undefined {
  if (!Array.isArray(phaseResults)) return undefined;
  return (phaseResults as LinksPhaseRow[]).find((p) => p.phase === "links");
}

function extractDecisions(links: LinksPhaseRow | undefined): DecisionStep[] {
  const decisions = links?.acquisitionPlan?.trace ?? links?.acquisitionPlan?.decisions ?? [];
  return decisions.map((d) => ({
    ms: d.ms ?? 0,
    phase: d.step,
    action: d.action,
    detail: d.reason,
  }));
}

function belongsTo(row: { submission_id: string | null; brand_id: string | null }, target: TargetRow): boolean {
  return target.target_type === "submission"
    ? row.submission_id === target.target_id
    : row.brand_id === target.target_id;
}

function toSpans(scrapes: ScrapeRow[], ai: AiRow[], target: TargetRow): ToolSpan[] {
  const mine = [
    ...scrapes.filter((r) => belongsTo(r, target)).map((r) => ({
      spanId: r.audit_span_id ?? "",
      provider: r.provider ?? "scraper",
      at: Date.parse(r.created_at),
      durationMs: r.latency_ms ?? 0,
      status: r.http_status ?? 0,
      detail: `${r.call_status ?? ""} ${r.endpoint ?? ""}`.trim(),
    })),
    ...ai.filter((r) => belongsTo(r, target)).map((r) => ({
      spanId: r.audit_span_id ?? "",
      provider: "openai",
      at: Date.parse(r.created_at),
      durationMs: r.latency_ms ?? 0,
      status: 200,
      detail: `${r.model ?? ""} in=${r.raw_response?.usage?.prompt_tokens ?? "?"} out=${r.raw_response?.usage?.completion_tokens ?? "?"}`,
    })),
  ];
  const t0 = mine.length ? Math.min(...mine.map((s) => s.at)) : 0;
  return mine.map(({ at, ...s }) => ({ ...s, ms: at - t0 }));
}

function slugFor(target: TargetRow): string {
  if (target.brand_slug) return target.brand_slug;
  const fromName = (target.brand_name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return fromName || target.target_id;
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
  const { targets, scrapes, aiResults } = await fetchTraces(client, jobId);
  console.log(
    `[traces] ${targets.length} targets, ${scrapes.length} scrape attempts, ${aiResults.length} agent turns`,
  );

  const outDir = resolve(`docs/dev-1644/traces/${jobId}`);
  await mkdir(outDir, { recursive: true });

  const summary: string[] = [
    `# Cohort traces — job ${jobId}`,
    "",
    "| brand | links | agentOutcome | surfaces | fanOut | probes/renders/search/turns used | scrape attempts | agent turns | tokens in/out | trace steps | error |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const target of targets) {
    const slug = slugFor(target);
    const links = linksPhase(target.phase_results);
    const decisions = extractDecisions(links);
    const spans = toSpans(scrapes, aiResults, target);
    const turns = aiResults.filter((r) => belongsTo(r, target));
    const tokIn = turns.reduce((n, r) => n + Number(r.raw_response?.usage?.prompt_tokens ?? 0), 0);
    const tokOut = turns.reduce((n, r) => n + Number(r.raw_response?.usage?.completion_tokens ?? 0), 0);

    const md = renderDecisionTimeline(slug, decisions, spans);
    await writeFile(resolve(outDir, `${slug}.md`), md + "\n");
    await writeFile(
      resolve(outDir, `${slug}.json`),
      JSON.stringify({ slug, target, links, decisions, spans }, null, 2) + "\n",
    );

    const used = links?.acquisitionPlan?.budget?.used;
    const usedCell = used ? `${used.probes ?? 0}/${used.renders ?? 0}/${used.search ?? 0}/${used.turns ?? 0}` : "-";
    summary.push(
      `| ${slug} | ${links?.status ?? "-"} | ${links?.agentOutcome ?? "-"} | ${links?.acquisitionPlan?.surfaces?.length ?? "-"} | ${links?.acquisitionPlan?.fanOut?.length ?? "-"} | ${usedCell} | ${spans.filter((s) => s.provider !== "openai").length} | ${turns.length} | ${tokIn}/${tokOut} | ${decisions.length} | ${links?.acquisitionPlan?.error ?? ""} |`,
    );
    console.log(`[traces] wrote ${slug}`);
  }

  await writeFile(resolve(outDir, "README.md"), summary.join("\n") + "\n");
  console.log(`[traces] done — ${outDir}`);
}

if (process.env.VITEST !== 'true') {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
