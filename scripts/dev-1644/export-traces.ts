/**
 * Per-brand trace export for a curation job — decisions, tool spans, AI results.
 * Outputs per-brand markdown + JSON under docs/dev-1644/traces/<job>/.
 *
 * Covers all three agents, not just acquisition: the acquire phase key is
 * `acquire` (the retired `links` is still read so PR-1-era rows export), and
 * the model turns come from every phase the run can write to
 * `brand_ai_results.phase`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  costFromUsage,
  selectPrice,
  usageFromRawResponse,
  type PriceRow,
  type TokenUsage,
} from "@/lib/services/llm-pricing";

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

/**
 * One entry of `curation_job_targets.phase_results`, narrowed to the fields
 * this export reads. Written by `buildPhaseResult` and validated on read by
 * `parsePhaseResults`; unknown keys are simply not looked at here.
 */
export type PhaseResultRow = {
  phase: string;
  status?: string;
  durationMs?: number;
  agentOutcome?: string;
  changedFields?: string[];
  revokedColumns?: string[];
  imagePool?: Array<{
    id: string;
    tag: string;
    score: number;
    sourceUrl?: string;
  }>;
  productsVerification?: Record<string, unknown>;
  acquisitionPlan?: {
    surfaces?: Array<{
      url: string;
      fetch: string;
      strategy?: string;
      reason: string;
    }>;
    fanOut?: string[];
    decisions?: Array<{
      step: string;
      action: string;
      reason: string;
      ms: number;
    }>;
    /** Runtime decision trace from the graph (gather/plan/execute/critique/finalize). */
    trace?: Array<{ step: string; action: string; reason: string; ms: number }>;
    budget?: { allowed: Record<string, number>; used: Record<string, number> };
    error?: string;
  };
};

/** One `brand_ai_results` row — a single model turn made by one of the agents. */
export type AiTurn = {
  model: string | null;
  phase?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  cached_prompt_tokens?: number | null;
  cost_usd?: number | null;
  raw_response?: unknown;
  created_at: string;
};

export type SearchCounts = { serp: number; image: number; scrape: number };

export type TurnTotals = {
  turns: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  /** Turns whose model has no row in `llm_model_prices` — unknown, not free. */
  unpricedTurns: number;
};

export type BrandTraceRow = {
  slug: string;
  acquireStatus: string;
  acquireOutcome: string;
  productsOutcome: string;
  editorial: string;
  turns: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  unpricedTurns: number;
  renders: number;
  searches: SearchCounts;
  durations: { acquire: number; products: number; editorial: number };
  images: { stored: number; kept: number; hero: string };
  revokedColumns: string[];
  products: {
    proposed: number;
    verified: number;
    dropped: number;
    rendered: number;
  };
  surfaces: number;
  fanOut: number;
  scrapeAttempts: number;
  traceSteps: number;
  error: string;
};

// ---------------------------------------------------------------------------
// Phase vocabulary
// ---------------------------------------------------------------------------

/**
 * Priority order, not a set: `acquire` is what the pipeline writes today, and
 * `links` is the retired key PR-1-era rows still carry (DEV-1644 F18). A row
 * holding both is read as `acquire`.
 */
export const ACQUIRE_PHASE_KEYS = ["acquire", "links"] as const;

/** The three phases the editorial agent wraps, in run order. */
export const EDITORIAL_PHASE_KEYS = [
  "descriptions",
  "stockists",
  "faq",
] as const;

/**
 * Every `brand_ai_results.phase` a run of the three agents can write.
 * `acquisition` is the historical sub-phase string used before the acquire
 * rename; it stays so an older job still exports its turns.
 */
export const TRACE_AI_PHASES = [
  "acquire",
  "acquisition",
  "products",
  "descriptions",
  "names",
  "stockists",
  "faq",
] as const;

/**
 * Tags that mark an image as rejected. Mirrors `JUNK_TAGS` in
 * `src/lib/services/enrich-phases/classify-images.ts`, which is the source of
 * truth; it is restated here so this export stays a leaf script rather than
 * pulling the classifier's OpenAI/Langfuse import chain into a report.
 */
const JUNK_IMAGE_TAGS = new Set(["promo", "text_banner", "irrelevant"]);

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

function phaseRows(phaseResults: unknown): PhaseResultRow[] {
  if (!Array.isArray(phaseResults)) return [];
  return phaseResults.filter(
    (row): row is PhaseResultRow =>
      typeof row === "object" &&
      row !== null &&
      typeof (row as PhaseResultRow).phase === "string",
  );
}

/** First phase result matching `names`, honouring the order of `names`. */
export function findPhaseResult(
  phaseResults: unknown,
  names: readonly string[],
): PhaseResultRow | undefined {
  const rows = phaseRows(phaseResults);
  for (const name of names) {
    const found = rows.find((row) => row.phase === name);
    if (found) return found;
  }
  return undefined;
}

export function acquirePhaseResult(
  phaseResults: unknown,
): PhaseResultRow | undefined {
  return findPhaseResult(phaseResults, ACQUIRE_PHASE_KEYS);
}

export function productsPhaseResult(
  phaseResults: unknown,
): PhaseResultRow | undefined {
  return findPhaseResult(phaseResults, ["products"]);
}

export function extractDecisions(
  phase: PhaseResultRow | undefined,
): DecisionStep[] {
  const decisions =
    phase?.acquisitionPlan?.trace ?? phase?.acquisitionPlan?.decisions ?? [];
  return decisions.map((d) => ({
    ms: d.ms ?? 0,
    phase: d.step,
    action: d.action,
    detail: d.reason,
  }));
}

/**
 * The editorial agent's outcome, phase by phase. One string rather than three
 * columns: the agent wraps all three phases in a single run, so what a reader
 * checks is whether any of them fell back.
 */
export function editorialOutcome(phaseResults: unknown): string {
  const rows = phaseRows(phaseResults);
  const parts = EDITORIAL_PHASE_KEYS.flatMap((name) => {
    const row = rows.find((entry) => entry.phase === name);
    return row ? [`${name}:${row.agentOutcome ?? "-"}`] : [];
  });
  return parts.length > 0 ? parts.join(" ") : "-";
}

/**
 * Stored / kept / hero for the persisted acquire pool. The pool arrives in rank
 * order, so the hero is the first entry the classifier did not reject.
 */
export function summarizeImagePool(
  pool: PhaseResultRow["imagePool"] | undefined,
): { stored: number; kept: number; hero: string } {
  const entries = pool ?? [];
  const kept = entries.filter((image) => !JUNK_IMAGE_TAGS.has(image.tag));
  return {
    stored: entries.length,
    kept: kept.length,
    hero: kept.at(0)?.id ?? "-",
  };
}

function numberField(record: unknown, key: string): number {
  if (typeof record !== "object" || record === null) return 0;
  const value = (record as Record<string, unknown>)[key];
  return typeof value === "number" ? value : 0;
}

export function summarizeProductsVerification(verification: unknown): {
  proposed: number;
  verified: number;
  dropped: number;
  rendered: number;
} {
  return {
    proposed: numberField(verification, "proposed"),
    verified: numberField(verification, "verified"),
    dropped: numberField(verification, "dropped"),
    rendered: numberField(verification, "rendered"),
  };
}

export function countSearches(
  rows: Array<{ search_type: string | null }>,
): SearchCounts {
  const counts: SearchCounts = { serp: 0, image: 0, scrape: 0 };
  for (const row of rows) {
    if (row.search_type === "serp") counts.serp += 1;
    else if (row.search_type === "image") counts.image += 1;
    else if (row.search_type === "scrape") counts.scrape += 1;
  }
  return counts;
}

export function phaseDurations(phaseResults: unknown): {
  acquire: number;
  products: number;
  editorial: number;
} {
  const rows = phaseRows(phaseResults);
  const durationOf = (name: string) =>
    rows.find((row) => row.phase === name)?.durationMs ?? 0;

  return {
    acquire:
      acquirePhaseResult(phaseResults)?.durationMs ?? 0,
    products: durationOf("products"),
    editorial: EDITORIAL_PHASE_KEYS.reduce(
      (total, name) => total + durationOf(name),
      0,
    ),
  };
}

/**
 * Token usage for one turn. The audit columns are authoritative; the
 * `raw_response` envelope is the fallback for rows written before the agent
 * runtime started filling them in (DEV-1644 F15).
 */
export function usageForTurn(turn: AiTurn): TokenUsage {
  if (
    typeof turn.prompt_tokens === "number" ||
    typeof turn.completion_tokens === "number"
  ) {
    return {
      prompt_tokens: turn.prompt_tokens ?? 0,
      completion_tokens: turn.completion_tokens ?? 0,
      ...(typeof turn.cached_prompt_tokens === "number"
        ? { prompt_tokens_details: { cached_tokens: turn.cached_prompt_tokens } }
        : {}),
    };
  }
  return usageFromRawResponse(turn.raw_response) ?? {};
}

/**
 * Turns, tokens and dollars for one brand.
 *
 * A turn the audit already priced keeps its stored cost — that is the rate that
 * was live when it ran. Anything else is priced from `llm_model_prices` at the
 * turn's own timestamp, and a model with no price row is counted rather than
 * charged at zero.
 */
export function summarizeTurns(
  turns: AiTurn[],
  prices: PriceRow[],
): TurnTotals {
  let promptTokens = 0;
  let completionTokens = 0;
  let costUsd = 0;
  let unpricedTurns = 0;

  for (const turn of turns) {
    const usage = usageForTurn(turn);
    promptTokens += usage.prompt_tokens ?? 0;
    completionTokens += usage.completion_tokens ?? 0;

    if (typeof turn.cost_usd === "number") {
      costUsd += turn.cost_usd;
      continue;
    }

    const price = selectPrice(
      prices,
      turn.model ?? "",
      new Date(turn.created_at),
    );
    const breakdown = costFromUsage(usage, price);
    if (breakdown.costUsd === null) unpricedTurns += 1;
    else costUsd += breakdown.costUsd;
  }

  return {
    turns: turns.length,
    promptTokens,
    completionTokens,
    costUsd,
    unpricedTurns,
  };
}

export function buildBrandTraceRow(input: {
  slug: string;
  phaseResults: unknown;
  turns: AiTurn[];
  prices: PriceRow[];
  searches: Array<{ search_type: string | null }>;
}): BrandTraceRow {
  const acquire = acquirePhaseResult(input.phaseResults);
  const products = productsPhaseResult(input.phaseResults);
  const productTotals = summarizeProductsVerification(
    products?.productsVerification,
  );
  const totals = summarizeTurns(input.turns, input.prices);
  const decisions = extractDecisions(acquire);
  const searches = countSearches(input.searches);

  return {
    slug: input.slug,
    acquireStatus: acquire?.status ?? "-",
    acquireOutcome: acquire?.agentOutcome ?? "-",
    productsOutcome: products?.agentOutcome ?? "-",
    editorial: editorialOutcome(input.phaseResults),
    turns: totals.turns,
    promptTokens: totals.promptTokens,
    completionTokens: totals.completionTokens,
    costUsd: totals.costUsd,
    unpricedTurns: totals.unpricedTurns,
    // Browserless spans carry no job or subject id, so per-brand renders come
    // from the two places that DO record them per brand: the acquisition
    // agent's budget ledger and the products agent's verification record.
    renders:
      (acquire?.acquisitionPlan?.budget?.used?.renders ?? 0) +
      productTotals.rendered,
    searches,
    durations: phaseDurations(input.phaseResults),
    images: summarizeImagePool(acquire?.imagePool),
    revokedColumns: acquire?.revokedColumns ?? [],
    products: productTotals,
    surfaces: acquire?.acquisitionPlan?.surfaces?.length ?? 0,
    fanOut: acquire?.acquisitionPlan?.fanOut?.length ?? 0,
    scrapeAttempts: searches.scrape,
    traceSteps: decisions.length,
    error: acquire?.acquisitionPlan?.error ?? "",
  };
}

const SUMMARY_COLUMNS = [
  "brand",
  "acquire",
  "acquireOutcome",
  "productsOutcome",
  "editorial",
  "turns",
  "tokens in/out",
  "cost USD",
  "renders",
  "searches serp/image/scrape",
  "wall clock acquire/products/editorial (ms)",
  "images stored/kept/hero",
  "revokedColumns",
  "products proposed/verified/dropped",
  "surfaces",
  "fanOut",
  "trace steps",
  "error",
] as const;

/** A pipe inside a value would split the row into extra columns. */
function cell(value: string | number): string {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function renderSummaryTable(
  jobId: string,
  rows: BrandTraceRow[],
): string {
  const lines: string[] = [
    `# Cohort traces — job ${jobId}`,
    "",
    `| ${SUMMARY_COLUMNS.join(" | ")} |`,
    `| ${SUMMARY_COLUMNS.map(() => "---").join(" | ")} |`,
  ];

  for (const row of rows) {
    const cost =
      row.unpricedTurns > 0
        ? `${row.costUsd.toFixed(4)} (+${row.unpricedTurns} unpriced)`
        : row.costUsd.toFixed(4);

    lines.push(
      `| ${[
        row.slug,
        row.acquireStatus,
        row.acquireOutcome,
        row.productsOutcome,
        row.editorial,
        row.turns,
        `${row.promptTokens}/${row.completionTokens}`,
        cost,
        row.renders,
        `${row.searches.serp}/${row.searches.image}/${row.searches.scrape}`,
        `${row.durations.acquire}/${row.durations.products}/${row.durations.editorial}`,
        `${row.images.stored}/${row.images.kept}/${row.images.hero}`,
        row.revokedColumns.join(" ") || "-",
        `${row.products.proposed}/${row.products.verified}/${row.products.dropped}`,
        row.surfaces,
        row.fanOut,
        row.traceSteps,
        row.error,
      ]
        .map(cell)
        .join(" | ")} |`,
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
// `brand_search_results` (one row per scrape or search attempt, `audit_span_id`
// set) and `brand_ai_results` (one row per model turn) are the authoritative
// stores.
// ---------------------------------------------------------------------------

type TargetRow = {
  target_type: string;
  target_id: string;
  brand_name: string | null;
  brand_slug: string | null;
  status: string;
  phase_results: unknown;
};

type ScrapeRow = {
  submission_id: string | null;
  brand_id: string | null;
  audit_span_id: string | null;
  provider: string | null;
  search_type: string | null;
  endpoint: string | null;
  call_status: string | null;
  http_status: number | null;
  latency_ms: number | null;
  created_at: string;
};

type AiRow = AiTurn & {
  submission_id: string | null;
  brand_id: string | null;
  audit_span_id: string | null;
  latency_ms: number | null;
};

async function fetchTraces(
  client: ReturnType<typeof createWriteBlockingClient>["client"],
  jobId: string,
) {
  const { data: targets, error: tErr } = await client
    .from("curation_job_targets")
    .select(
      "target_type, target_id, brand_name, brand_slug, status, phase_results",
    )
    .eq("job_id", jobId);
  if (tErr) throw new Error(`curation_job_targets query failed: ${tErr.message}`);

  // Every search row for the job — scrape attempts feed the timeline, serp and
  // image rows are the agent's recovery searches.
  const { data: scrapes, error: sErr } = await client
    .from("brand_search_results")
    .select(
      "submission_id, brand_id, audit_span_id, provider, search_type, endpoint, call_status, http_status, latency_ms, created_at",
    )
    .eq("job_id", jobId)
    .limit(1000);
  if (sErr) throw new Error(`brand_search_results query failed: ${sErr.message}`);

  const { data: aiResults, error: aiErr } = await client
    .from("brand_ai_results")
    .select(
      "submission_id, brand_id, audit_span_id, model, phase, latency_ms, prompt_tokens, completion_tokens, cached_prompt_tokens, cost_usd, raw_response, created_at",
    )
    .eq("job_id", jobId)
    .in("phase", [...TRACE_AI_PHASES])
    .limit(1000);
  if (aiErr) throw new Error(`brand_ai_results query failed: ${aiErr.message}`);

  const { data: prices, error: pErr } = await client
    .from("llm_model_prices")
    .select("model, input_per_m, cached_input_per_m, output_per_m, effective_from")
    .order("effective_from", { ascending: false });
  if (pErr) throw new Error(`llm_model_prices query failed: ${pErr.message}`);

  // Job-level only: the render span carries neither job nor subject id, so this
  // reconciles the export's per-brand budget figures against the audit trail
  // rather than attributing renders to a brand.
  const { count: renderSpans, error: rErr } = await client
    .from("external_call_audit")
    .select("id", { count: "exact", head: true })
    .eq("provider", "browserless")
    .eq("job_id", jobId);
  if (rErr) throw new Error(`external_call_audit query failed: ${rErr.message}`);

  return {
    targets: (targets ?? []) as TargetRow[],
    scrapes: (scrapes ?? []) as ScrapeRow[],
    aiResults: (aiResults ?? []) as AiRow[],
    prices: (prices ?? []) as PriceRow[],
    renderSpans: renderSpans ?? 0,
  };
}

function belongsTo(
  row: { submission_id: string | null; brand_id: string | null },
  target: TargetRow,
): boolean {
  return target.target_type === "submission"
    ? row.submission_id === target.target_id
    : row.brand_id === target.target_id;
}

function toSpans(scrapes: ScrapeRow[], ai: AiRow[], target: TargetRow): ToolSpan[] {
  const mine = [
    ...scrapes
      .filter((r) => belongsTo(r, target))
      .map((r) => ({
        spanId: r.audit_span_id ?? "",
        provider: r.provider ?? "scraper",
        at: Date.parse(r.created_at),
        durationMs: r.latency_ms ?? 0,
        status: r.http_status ?? 0,
        detail: `${r.search_type ?? ""} ${r.call_status ?? ""} ${r.endpoint ?? ""}`.trim(),
      })),
    ...ai
      .filter((r) => belongsTo(r, target))
      .map((r) => {
        const usage = usageForTurn(r);
        return {
          spanId: r.audit_span_id ?? "",
          provider: `openai:${r.phase ?? "?"}`,
          at: Date.parse(r.created_at),
          durationMs: r.latency_ms ?? 0,
          status: 200,
          detail: `${r.model ?? ""} in=${usage.prompt_tokens ?? "?"} out=${usage.completion_tokens ?? "?"}`,
        };
      }),
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
  const { targets, scrapes, aiResults, prices, renderSpans } = await fetchTraces(
    client,
    jobId,
  );
  console.log(
    `[traces] ${targets.length} targets, ${scrapes.length} search rows, ${aiResults.length} agent turns, ${renderSpans} browserless spans carrying the job id`,
  );

  const outDir = resolve(`docs/dev-1644/traces/${jobId}`);
  await mkdir(outDir, { recursive: true });

  const rows: BrandTraceRow[] = [];

  for (const target of targets) {
    const slug = slugFor(target);
    const acquire = acquirePhaseResult(target.phase_results);
    const decisions = extractDecisions(acquire);
    const spans = toSpans(scrapes, aiResults, target);
    const turns = aiResults.filter((r) => belongsTo(r, target));
    const searches = scrapes.filter((r) => belongsTo(r, target));

    const row = buildBrandTraceRow({
      slug,
      phaseResults: target.phase_results,
      turns,
      prices,
      searches,
    });
    rows.push(row);

    const md = renderDecisionTimeline(slug, decisions, spans);
    await writeFile(resolve(outDir, `${slug}.md`), md + "\n");
    await writeFile(
      resolve(outDir, `${slug}.json`),
      JSON.stringify(
        { slug, target, summary: row, acquire, decisions, spans },
        null,
        2,
      ) + "\n",
    );

    console.log(`[traces] wrote ${slug}`);
  }

  const summary = [
    renderSummaryTable(jobId, rows),
    "",
    `Browserless spans carrying this job id: ${renderSpans}. Per-brand renders`,
    "come from the acquisition budget ledger and the products verification",
    "record, because a render span carries neither job nor subject id.",
  ].join("\n");

  await writeFile(resolve(outDir, "README.md"), summary + "\n");
  console.log(`[traces] done — ${outDir}`);
}

if (process.env.VITEST !== 'true') {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
