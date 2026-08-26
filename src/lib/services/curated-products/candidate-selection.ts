/**
 * Candidate selection for curated products (DEV-1610).
 *
 * Shape: gate -> LLM rank -> position tie-break -> variety constraint.
 * This is NOT a blended score. Gates are boolean exclusions, the LLM score
 * is the ONLY ranking number, search_position breaks ties only, and variety
 * is a set constraint applied during selection.
 *
 * Ranking runs INSIDE the existing `runProductsPhase` audited call, so this
 * module has NO `auditedCall` of its own and NO entry in `src/lib/audit/providers.ts`.
 *
 * Persistence is append-only (one row per candidate per run, no upsert).
 * A write failure is reported but never fails the phase.
 */

import { createServiceClient } from "@/lib/supabase/service";
import type { ProductCandidate } from "../enrich-phases/product-candidates";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A candidate that was excluded by a boolean gate. */
export type GatedCandidate = {
  candidate: ProductCandidate;
  gateResult: "no_image" | "not_product_detail" | "near_duplicate";
};

/** A ranked candidate with LLM score and final rank. */
export type RankedCandidate = {
  url: string;
  normalizedUrl: string;
  title?: string;
  imageUrl?: string;
  supplier: string;
  urlClass: string;
  searchPosition?: number;
  llmScore: number;
  llmRationale: string;
  finalRank: number;
};

/** One row in `curated_product_candidates`. */
export type CandidateRow = {
  brand_id: string;
  submission_id: string | null;
  job_id: string | null;
  url: string;
  normalized_url: string;
  title: string | null;
  image_url: string | null;
  supplier: string;
  url_class: string;
  search_position: number | null;
  gate_result: string;
  llm_score: number | null;
  llm_rationale: string | null;
  final_rank: number | null;
};

/** Narrowest writer type — injectable for testing and production. */
export type CandidateWriter = {
  insert: (rows: CandidateRow[]) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

/**
 * Default writer that appends to `curated_product_candidates` via the
 * service client. The table may not exist yet (migration not applied),
 * in which case the insert reports an error and the phase continues —
 * that is designed degradation, not a bug.
 */
export function createDefaultCandidateWriter(): CandidateWriter {
  // `curated_product_candidates` is absent from the generated database types
  // until the migration is applied, so the client is narrowed structurally to
  // the one call this writer makes rather than widened to `any`.
  const supabase = createServiceClient() as unknown as {
    from(table: string): {
      insert(rows: CandidateRow[]): Promise<{
        data: unknown;
        error: { message: string } | null;
      }>;
    };
  };
  return {
    insert: async (rows) =>
      supabase.from("curated_product_candidates").insert(rows),
  };
}

/** LLM ranking function — injected so the phase's audited call wraps it. */
export type LlmRanker = (
  candidates: ProductCandidate[],
) => Promise<Array<{ url: string; score: number; rationale: string }>>;

export type CandidateSelectionResult = {
  ranked: RankedCandidate[];
  gated: GatedCandidate[];
  persistError: string | null;
};

// ---------------------------------------------------------------------------
// Gates (boolean exclusions)
// ---------------------------------------------------------------------------

/**
 * Applies deterministic gates to a candidate pool.
 *
 * Gates are boolean — a candidate either passes or is excluded with a reason.
 * No gate outcome is combined arithmetically with any score.
 *
 * @param pool - all candidates to evaluate
 * @param acceptedCandidates - already-accepted candidates (for near-duplicate check)
 */
export function applyGates(
  pool: ProductCandidate[],
  acceptedCandidates: ProductCandidate[],
): { gated: GatedCandidate[]; passed: ProductCandidate[] } {
  const gated: GatedCandidate[] = [];
  const passed: ProductCandidate[] = [];

  // Build the accepted set of normalized URLs for near-duplicate checking.
  const acceptedUrls = new Set(acceptedCandidates.map((c) => c.normalizedUrl));

  for (const candidate of pool) {
    // Gate 1: no usable image.
    if (!candidate.imageUrl) {
      gated.push({ candidate, gateResult: "no_image" });
      continue;
    }

    // Gate 2: not a product-detail page.
    if (candidate.urlClass !== "product-detail") {
      gated.push({ candidate, gateResult: "not_product_detail" });
      continue;
    }

    // Gate 3: near-duplicate of an already-accepted candidate.
    if (acceptedUrls.has(candidate.normalizedUrl)) {
      gated.push({ candidate, gateResult: "near_duplicate" });
      continue;
    }

    passed.push(candidate);
    // Add to accepted set so subsequent candidates in THIS pool are also
    // checked against already-selected ones (variety constraint).
    acceptedUrls.add(candidate.normalizedUrl);
  }

  return { gated, passed };
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * Ranks gate-passing candidates by LLM score, with search_position as
 * tie-breaker ONLY. A lower position never overrides a higher LLM score.
 *
 * @returns Ranked candidates sorted by (llmScore DESC, searchPosition ASC).
 */
export async function rankAndSelect(
  candidates: ProductCandidate[],
  ranker: LlmRanker,
  maxProducts: number,
): Promise<RankedCandidate[]> {
  if (candidates.length === 0) return [];

  const scores = await ranker(candidates);
  const scoreMap = new Map(scores.map((s) => [s.url, s]));

  // Build scored entries.
  const scored = candidates.map((c) => {
    const entry = scoreMap.get(c.url);
    return {
      candidate: c,
      llmScore: entry?.score ?? 0,
      llmRationale: entry?.rationale ?? "",
    };
  });

  // Sort: LLM score descending, then search_position ascending (tie-break).
  scored.sort((a, b) => {
    const scoreDiff = b.llmScore - a.llmScore;
    if (scoreDiff !== 0) return scoreDiff;
    const posA = a.candidate.searchPosition ?? Number.MAX_SAFE_INTEGER;
    const posB = b.candidate.searchPosition ?? Number.MAX_SAFE_INTEGER;
    return posA - posB;
  });

  return scored.slice(0, maxProducts).map((entry, index) => ({
    url: entry.candidate.url,
    normalizedUrl: entry.candidate.normalizedUrl,
    title: entry.candidate.title,
    imageUrl: entry.candidate.imageUrl,
    supplier: entry.candidate.supplier,
    urlClass: entry.candidate.urlClass,
    searchPosition: entry.candidate.searchPosition,
    llmScore: entry.llmScore,
    llmRationale: entry.llmRationale,
    finalRank: index + 1,
  }));
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function candidateToRow(
  candidate: ProductCandidate,
  gateResult: string,
  brandId: string,
  submissionId: string | null,
  jobId: string | null,
  llmScore: number | null,
  llmRationale: string | null,
  finalRank: number | null,
): CandidateRow {
  return {
    brand_id: brandId,
    submission_id: submissionId ?? null,
    job_id: jobId ?? null,
    url: candidate.url,
    normalized_url: candidate.normalizedUrl,
    title: candidate.title ?? null,
    image_url: candidate.imageUrl ?? null,
    supplier: candidate.supplier,
    url_class: candidate.urlClass,
    search_position: candidate.searchPosition ?? null,
    gate_result: gateResult,
    llm_score: llmScore,
    llm_rationale: llmRationale,
    final_rank: finalRank,
  };
}

/**
 * Runs the full selection pipeline: gate -> rank -> persist.
 *
 * Persists EVERY candidate (including gated-out ones), one row per candidate
 * per run. Append-only — no upsert, no `onConflict`.
 *
 * A persistence failure is reported but does NOT fail the phase; proposals
 * still return.
 */
export async function persistCandidatePool(options: {
  pool: ProductCandidate[];
  acceptedCandidates: ProductCandidate[];
  ranker: LlmRanker;
  writer: CandidateWriter;
  brandId: string;
  submissionId: string | null;
  jobId?: string | null;
  maxProducts: number;
}): Promise<CandidateSelectionResult> {
  const {
    pool,
    acceptedCandidates,
    ranker,
    writer,
    brandId,
    submissionId,
    jobId,
    maxProducts,
  } = options;

  // Step 1: Gate
  const { gated, passed } = applyGates(pool, acceptedCandidates);

  // Step 2: Rank
  const ranked = await rankAndSelect(passed, ranker, maxProducts);

  // Step 3: Build rows for persistence — every candidate, including gated ones.
  const rows: CandidateRow[] = [];

  // Gated candidates: no LLM score, no rank.
  for (const g of gated) {
    rows.push(
      candidateToRow(
        g.candidate,
        g.gateResult,
        brandId,
        submissionId,
        jobId ?? null,
        null,
        null,
        null,
      ),
    );
  }

  // Ranked candidates: carry LLM score, rationale, and rank.
  const rankedMap = new Map(ranked.map((r) => [r.url, r]));
  for (const c of passed) {
    const r = rankedMap.get(c.url);
    rows.push(
      candidateToRow(
        c,
        "passed",
        brandId,
        submissionId,
        jobId ?? null,
        r?.llmScore ?? null,
        r?.llmRationale ?? null,
        r?.finalRank ?? null,
      ),
    );
  }

  // Step 4: Persist — append-only, never upsert.
  let persistError: string | null = null;
  if (rows.length > 0) {
    const { error } = await writer.insert(rows);
    if (error) {
      persistError = error.message;
    }
  }

  return { ranked, gated, persistError };
}
