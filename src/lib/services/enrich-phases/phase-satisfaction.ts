import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePhaseResults } from "@/lib/services/phase-results";
import {
  ENRICH_PHASES,
  PHASE_DEPENDENCIES,
  type EnrichPhaseName,
} from "@/lib/constants/enrich-phases";

/**
 * Map from phase name to the most recent time it succeeded, derived from
 * `curation_job_targets.phase_results` history rows.
 */
export type PhaseHistory = Map<EnrichPhaseName, Date>;

/**
 * Fetches the phase-success history for a single target from
 * `curation_job_targets`. For each phase that ever succeeded, the map holds
 * the most recent success timestamp.
 */
export async function fetchPhaseHistory(
  supabase: SupabaseClient,
  targetType: string,
  targetId: string,
): Promise<PhaseHistory> {
  const { data, error } = await supabase
    .from("curation_job_targets")
    .select("phase_results, created_at")
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw error;

  const history: PhaseHistory = new Map();

  for (const row of data ?? []) {
    if (!row.phase_results) continue;
    const results = parsePhaseResults(row.phase_results);

    for (const result of results) {
      if (result.status !== "succeeded") continue;

      // Normalise the legacy `expansion` name to `reputation`.
      const rawPhase =
        result.phase === "expansion" ? "reputation" : result.phase;

      if (!(ENRICH_PHASES as readonly string[]).includes(rawPhase)) continue;
      const phase = rawPhase as EnrichPhaseName;

      // First wins = most recent, because rows are ordered DESC.
      if (!history.has(phase)) {
        history.set(phase, new Date(row.created_at));
      }
    }
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
