/**
 * Re-export from the canonical location in src/lib/services.
 * This file exists so that any existing relative imports from scripts/ continue to resolve.
 */
export {
  classifyInfrastructure,
  evaluateSelfMerge,
  freezeFailures,
  nextIncidentState,
  renderIncidentPrBody,
  terminalOutcome,
  validateDiagnosis,
  validateRepair,
  type DiagnosisCluster,
  type DiagnosisFailure,
  type DiagnosisResult,
  type FailureCategory,
  type FrozenFailure,
  type FrozenFailureSet,
  type IncidentCounters,
  type IncidentPrBodyInput,
  type IncidentTransition,
  type MergeEligibility,
  type RepairResult,
  type SelfMergeEvidence,
  type SourceFailure,
  type TerminalOutcome,
} from "@/lib/services/e2e-selfheal/incident";
