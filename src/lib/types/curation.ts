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
}

export interface CurationPatchEvent {
  targetId: string;
  targetType: "submission" | "brand";
  slug: string;
  name: string;
  patch: Record<string, unknown>;
  phaseResults: PhaseResult[];
}

export type PhaseResultStatus = "succeeded" | "skipped" | "failed";

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
  agentOutcome?: 'planned' | 'recovered' | 'fallback' | 'blocked' | 'skipped';
  acquisitionPlan?: Record<string, unknown>;
  revokedColumns?: string[];
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
