/**
 * @formoria-script
 * purpose: Pure trace-summary functions extracted from export-traces for reuse by the eval harness.
 * class: shared
 * invoke: pnpm exec tsx scripts/enrichment/eval/trace-summary.ts
 * target: none
 * safety: read-only
 * owner: engineering
 */
import {
  costFromUsage,
  selectPrice,
  usageFromRawResponse,
  type PriceRow,
  type TokenUsage,
} from "@/lib/services/llm-pricing";

// ---------------------------------------------------------------------------
// Types — exported for tests and downstream consumers
// ---------------------------------------------------------------------------

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
  error?: string;
  detail?: string;
  providerFailure?: boolean;
  catalogZeroReason?: string;
  productsProposed?: number;
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
// Pure helpers
// ---------------------------------------------------------------------------

export function phaseRows(phaseResults: unknown): PhaseResultRow[] {
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
): { ms: number; phase: string; action: string; detail: string }[] {
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
    // Render spans carry no job or subject id, so per-brand renders come
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
