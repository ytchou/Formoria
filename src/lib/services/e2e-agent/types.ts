/**
 * E2E nightly agent type definitions.
 *
 * Used by the self-heal LangGraph (Tasks 7-9) and the runner (Task 6).
 */

import type { ChangedFile } from '@/repo-worker/jobs'

// ---------------------------------------------------------------------------
// Frozen failure — a Playwright test failure captured for diagnosis
// ---------------------------------------------------------------------------

export type FrozenFailure = {
  file: string
  title: string
  error: string
  fingerprint: string
}

// ---------------------------------------------------------------------------
// Diagnosis
// ---------------------------------------------------------------------------

export type DiagnosisClassification =
  | 'noise'
  | 'environment'
  | 'code_drift'
  | 'product_bug'

export type DiagnosisResult = {
  classification: DiagnosisClassification
  explanation: string
  suggestedFiles: string[]
}

// ---------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------

export type RepairResult = {
  changedFiles: ChangedFile[]
  branch: string
  baseSha: string
}

// ---------------------------------------------------------------------------
// Run outcome
// ---------------------------------------------------------------------------

export type RunOutcome =
  | 'green'
  | 'patched'
  | 'noise'
  | 'needs_human'
  | 'fallback'

// ---------------------------------------------------------------------------
// Self-heal graph state (LangGraph Annotation.Root schema)
// ---------------------------------------------------------------------------

export type E2eSelfHealState = {
  frozenFailures: FrozenFailure[]
  diagnosis: DiagnosisResult | null
  repair: RepairResult | null
  validation: { passed: boolean; output: string } | null
  outcome: RunOutcome
  cycle: number
  runId: string
  stagingSha: string
}
