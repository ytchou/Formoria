import type { BrandStatus } from "./brand";

export interface CurationConfig {
  dryRun: boolean;
  target?: "submissions" | "brands";
  submissionIds?: string[];
  overwrite?: boolean;
  slugs?: string[];
  status?: BrandStatus;
  limit?: number;
  onProgress?: (msg: string) => void;
  onTargetProgress?: (
    event: CurationTargetProgressEvent,
  ) => void | Promise<void>;
  /**
   * Fires once per target with the fully merged patch, immediately before the
   * persist branch. Exists for `dryRun` inspection: a dry run computes the
   * exact same patch and then throws it away, so without this hook the only
   * observable output is the *names* of the changed fields, never their values.
   * Never used by the production worker.
   */
  onPatch?: (event: CurationPatchEvent) => void | Promise<void>;
  jobId?: string;
  /** Multiplier for the per-brand time budget. >1 grants more time. */
  budgetScale?: number;
}

interface CurationPatchEvent {
  targetId: string;
  targetType: "submission" | "brand";
  slug: string;
  name: string;
  patch: Record<string, unknown>;
  phaseResults: PhaseResult[];
}

export type PhaseResultStatus = "succeeded" | "skipped" | "failed";

/**
 * Per-source answer of one channel-discovery step.
 *
 * `absent` is a POSITIVE finding — the source answered and carried no purchase
 * channel. Every fetch failure (timeout, 5xx, a 4xx that is not 404, an
 * oversized body, a network error) must map to `unknown` instead, because a
 * verdict that treats an outage as `absent` turns a bad afternoon into a
 * delisting wave. `skipped` means the source was never consulted.
 *
 * Lives in the types layer, not in `enrich-phases/link-expansion.ts`, so the
 * trace type and the producing service can both reference it without a
 * services -> types -> services cycle.
 */
export type SourceOutcome = "found" | "absent" | "unknown" | "skipped";

export interface PhaseResult {
  phase: string;
  status: PhaseResultStatus;
  changedFields: string[];
  durationMs: number;
  error?: string;
  detail?: string;
  /**
   * Set when this phase failed because a search/LLM provider was unavailable
   * (Gate A), not because the brand legitimately had no data. Persisted inside
   * `curation_job_targets.phase_results`, so the signal survives the worker /
   * Next split and is readable when the job summary is aggregated.
   */
  providerFailure?: boolean;
  catalogZeroReason?: string;
  productsProposed?: number;
  agentOutcome?: 'planned' | 'recovered' | 'fallback' | 'blocked' | 'skipped' | 'proposed' | 'repaired';
  acquisitionPlan?: Record<string, unknown>;
  /**
   * Compact summary of the acquire phase's ranked image pool, in rank order.
   *
   * The in-memory pool is `RankableImage[]` — the full classifier verdict per
   * image — and that is what the products agent consumes inside the same run.
   * What is PERSISTED is only what a re-run or the admin job view needs to read
   * back: the row id, the tag, the score, and the page the image came from.
   * Capped at 16 KB by the writer and again by `parsePhaseResults`.
   */
  imagePool?: Array<{
    id: string;
    tag: string;
    score: number;
    sourceUrl?: string;
  }>;
  productsVerification?: Record<string, unknown>;
  revokedColumns?: string[];
  /** Compact summary of the link-expansion sub-step inside acquire. */
  linkExpansion?: {
    hubsFetched: number;
    adopted: Array<{
      field: string;
      url: string;
      source: 'hub' | 'threads' | 'serp' | 'serp_handle';
    }>;
    serp: 'replayed' | 'searched' | 'none';
    gated?: string;
    /**
     * What each deterministic channel source answered. Absent on traces
     * written before DEV-1702 — a missing `sources` is not evidence of
     * anything, so the finalizer must read it as inconclusive.
     */
    sources?: {
      hubs: SourceOutcome;
      threads: SourceOutcome;
      serpName: SourceOutcome;
      serpHandle: SourceOutcome;
    };
    /** `conclusive` only when every source answered and none was `unknown`. */
    evidence?: 'conclusive' | 'inconclusive';
    instagramFollowers?: number;
  };
}

export interface BrandOutcome {
  slug: string;
  name: string;
  submissionId?: string;
  status: "succeeded" | "skipped" | "failed";
  changedFields?: string[];
  phaseResults?: PhaseResult[];
  error?: string;
}

export interface CurationTargetProgressEvent {
  targetId: string;
  targetType: "submission" | "brand";
  slug: string;
  name: string;
  status: "running" | "succeeded" | "skipped" | "failed";
  currentPhase?: string;
  phaseResults?: PhaseResult[];
  changedFields?: string[];
  error?: string;
  durationMs?: number;
}

export interface OperationResult {
  processed: number;
  updated: number;
  skipped: number;
  errors: string[];
  brandOutcomes: BrandOutcome[];
}
