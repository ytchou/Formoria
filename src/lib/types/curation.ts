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
  jobId?: string;
}

export type PhaseStatus = "succeeded" | "skipped" | "failed";

export interface PhaseResult {
  phase: string;
  status: PhaseStatus;
  changedFields: string[];
  durationMs: number;
  error?: string;
  detail?: string;
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
