import {
  ENRICH_PHASES,
  PHASE_DEPENDENCIES,
  type EnrichPhaseName,
} from "@/lib/constants/enrich-phases";
import {
  latestPhaseOutputs,
  createSupabasePhaseOutputStore,
  type PhaseOutputStore,
} from "@/lib/services/enrich-blocks/phase-outputs";
import type { EnrichmentTarget } from "@/lib/services/_shared/enrichment-target";

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

  const history: PhaseHistory = new Map();
  for (const [rawPhase, row] of outputs) {
    if (!(ENRICH_PHASES as readonly string[]).includes(rawPhase)) continue;
    const phase = rawPhase as EnrichPhaseName;
    history.set(phase, new Date(row.created_at));
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
    const depTime = history.get(dep);
    if (depTime && depTime.getTime() > phaseTime.getTime()) {
      return "unsatisfied";
    }
    // Transitive: if the dep itself is unsatisfied, this phase is stale.
    if (checkPhaseSatisfaction(dep, history, false, visited) === "unsatisfied") {
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
