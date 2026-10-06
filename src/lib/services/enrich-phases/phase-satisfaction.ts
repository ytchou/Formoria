import {
  ENRICH_PHASES,
  PHASE_DEPENDENCIES,
  type EnrichPhaseName,
} from "@/lib/constants/enrich-phases";
import {
  latestPhaseOutputs,
  createSupabasePhaseOutputStore,
  type PhaseOutputStore,
  type PhaseOutputRow,
  isUsablePhaseOutput,
} from "@/lib/services/enrich-blocks/phase-outputs";
import type { EnrichmentTarget } from "@/lib/services/_shared/enrichment-target";
import type { PhaseResult } from "@/lib/types/curation";
import {
  PRODUCTS_NO_CHANNEL_SKIP_DETAIL,
  PRODUCTS_SUBMISSION_ONLY_SKIP_DETAIL,
  SATISFIED_FROM_HISTORY_SKIP_DETAIL,
  STOCKISTS_NO_EVIDENCE_SKIP_DETAIL,
  STOCKISTS_NO_SIGNAL_SKIP_DETAIL,
  STOCKISTS_NONE_FOUND_SKIP_DETAIL,
} from "./types";

/**
 * Map from phase name to the most recent time it succeeded, derived from
 * `curation_phase_outputs` rows via the phase-outputs store.
 */
export type PhaseHistory = Map<EnrichPhaseName, Date>;

/**
 * Fetches the phase-success history for a single target from
 * `curation_phase_outputs`. For each phase that ever succeeded, the map holds
 * the most recent success timestamp.
 *
 * Accepts an optional `store` for testing; defaults to the Supabase
 * implementation.
 */
export async function fetchPhaseHistory(
  targetType: string,
  targetId: string,
  store?: PhaseOutputStore,
): Promise<PhaseHistory> {
  const resolvedStore = store ?? createSupabasePhaseOutputStore();
  const target: EnrichmentTarget = {
    type: targetType as EnrichmentTarget["type"],
    id: targetId,
  };

  const outputs = await latestPhaseOutputs(resolvedStore, target);

  return phaseHistoryFromOutputs([...outputs.values()]);
}

export function phaseHistoryFromOutputs(rows: readonly PhaseOutputRow[]): PhaseHistory {
  const history: PhaseHistory = new Map();
  for (const row of rows) {
    if (row.status !== "succeeded" || !isUsablePhaseOutput(row.output) ||
      !(ENRICH_PHASES as readonly string[]).includes(row.phase)) continue;
    const phase = row.phase as EnrichPhaseName;
    const timestamp = new Date(row.created_at);
    if (!Number.isFinite(timestamp.getTime())) continue;
    const previous = history.get(phase);
    if (!previous || timestamp > previous) history.set(phase, timestamp);
  }
  return history;
}

/**
 * Determines whether a phase needs to run based on execution history.
 *
 * A phase is `satisfied` when it has succeeded at least once AND none of its
 * dependencies have succeeded more recently (which would make this phase's
 * output stale). `force` unconditionally returns `unsatisfied`.
 */
export function checkPhaseSatisfaction(
  phase: EnrichPhaseName,
  history: PhaseHistory,
  force?: boolean,
  _visited?: Set<EnrichPhaseName>,
  scope?: readonly EnrichPhaseName[],
): "satisfied" | "unsatisfied" {
  if (force) return "unsatisfied";

  const phaseTime = history.get(phase);
  if (!phaseTime) return "unsatisfied";

  // Cycle guard (the DAG is acyclic, but defensive).
  const visited = _visited ?? new Set<EnrichPhaseName>();
  if (visited.has(phase)) return "satisfied";
  visited.add(phase);

  const deps = PHASE_DEPENDENCIES[phase];
  for (const dep of deps) {
    if (scope && !scope.includes(dep)) continue;
    const depTime = history.get(dep);
    if (depTime && depTime.getTime() > phaseTime.getTime()) {
      return "unsatisfied";
    }
    // Transitive: if the dep itself is unsatisfied, this phase is stale.
    if (checkPhaseSatisfaction(dep, history, false, visited, scope) === "unsatisfied") {
      return "unsatisfied";
    }
  }

  return "satisfied";
}

export type PhaseSkipEntry = {
  phase: EnrichPhaseName;
  reason: "satisfied";
};

/**
 * Filters a list of resolved phases, removing those whose satisfaction
 * check holds. Returns the phases to execute and a list of skipped
 * phases with their skip reason (distinguishable from "not requested").
 */
export function filterSatisfiedPhases(
  phases: readonly EnrichPhaseName[],
  history: PhaseHistory,
  force?: boolean,
): { execute: EnrichPhaseName[]; skipped: PhaseSkipEntry[] } {
  const execute: EnrichPhaseName[] = [];
  const skipped: PhaseSkipEntry[] = [];

  for (const phase of phases) {
    const result = checkPhaseSatisfaction(phase, history, force);
    if (result === "satisfied") {
      skipped.push({ phase, reason: "satisfied" });
    } else {
      execute.push(phase);
    }
  }

  return { execute, skipped };
}

/**
 * Skip details that prove a phase executed nothing. Fail-closed: any other
 * skip (wall clock or budget exhausted, a missing API key, a model call that
 * found nothing) means the phase started or could not run, so the target is not
 * a no-op. The stockists evidence skips are listed because they fire before any
 * model call, so the phase wrote and spent nothing. Stockists "none found" is
 * the one model-ran exception: it writes nothing, and keeping it fail-closed made
 * every rerun on a brand without listed stores block the apply gate (DEV-1928
 * staging check). Its cost is one small model call per rerun.
 */
const NO_OP_SKIP_DETAILS: ReadonlySet<string> = new Set([
  SATISFIED_FROM_HISTORY_SKIP_DETAIL,
  STOCKISTS_NO_EVIDENCE_SKIP_DETAIL,
  STOCKISTS_NO_SIGNAL_SKIP_DETAIL,
  STOCKISTS_NONE_FOUND_SKIP_DETAIL,
  PRODUCTS_SUBMISSION_ONLY_SKIP_DETAIL,
  PRODUCTS_NO_CHANNEL_SKIP_DETAIL,
]);

/**
 * True when a finished target ran nothing and wrote nothing: it owns zero
 * checkpoints and every recorded phase result is `skipped` with an allowlisted
 * detail (satisfied from history or not applicable). Persisted as
 * `curation_job_targets.no_op`, which the apply and approve gates ignore when
 * they pick the latest enrichment run, so an empty rerun cannot hide an
 * earlier `succeeded` run (DEV-1929).
 */
export function isNoOpTarget({
  phaseResults,
  checkpointCount,
}: {
  phaseResults: readonly PhaseResult[];
  checkpointCount: number;
}): boolean {
  return (
    checkpointCount === 0 &&
    phaseResults.length > 0 &&
    phaseResults.every(
      (result) =>
        result.status === "skipped" &&
        NO_OP_SKIP_DETAILS.has(result.detail ?? ""),
    )
  );
}
