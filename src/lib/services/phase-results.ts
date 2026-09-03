import type { Json } from "@/lib/supabase/database.types";
import type { PhaseResult, PhaseResultStatus } from "@/lib/types/curation";

const PHASE_STATUSES: readonly string[] = [
  "succeeded",
  "skipped",
  "failed",
] satisfies readonly PhaseResultStatus[];

const VALID_AGENT_OUTCOMES: readonly string[] = [
  "planned",
  "recovered",
  "fallback",
  "blocked",
  "skipped",
  "proposed",
  "repaired",
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Serialized ceiling for the persisted image pool — the writer's own cap. */
export const MAX_IMAGE_POOL_BYTES = 16_384;

/**
 * Drop trailing entries until the pool fits within `maxBytes`.
 * Used by acquire and acquisition to cap the persisted image pool.
 */
export function compactToBytes<T>(pool: readonly T[], maxBytes: number = MAX_IMAGE_POOL_BYTES): T[] {
  let result = [...pool];
  while (result.length > 0 && JSON.stringify(result).length > maxBytes) {
    result = result.slice(0, -1);
  }
  return result;
}

/**
 * The acquire phase's compact image pool, or `undefined`.
 *
 * Same shape of rule as `acquisitionPlan`: plain objects only, and dropped
 * whole rather than truncated once it exceeds its ceiling. A row written by an
 * older deploy carries the retired `{ url, score, tags }` shape; it is rejected
 * here for lacking `id`, which is exactly what stops the two incompatible pool
 * shapes (DEV-1644 F25) from both reading back as valid.
 */
function parseImagePool(value: unknown): PhaseResult["imagePool"] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (JSON.stringify(value).length > MAX_IMAGE_POOL_BYTES) return undefined;

  const entries = value.flatMap((entry) => {
    if (!isPlainObject(entry)) return [];
    if (typeof entry.id !== "string") return [];
    if (typeof entry.tag !== "string") return [];
    if (typeof entry.score !== "number") return [];
    return [
      {
        id: entry.id,
        tag: entry.tag,
        score: entry.score,
        ...(typeof entry.sourceUrl === "string"
          ? { sourceUrl: entry.sourceUrl }
          : {}),
      },
    ];
  });

  return entries.length === value.length ? entries : undefined;
}

/**
 * Single reader for `curation_job_targets.phase_results`.
 *
 * This used to exist twice with *different* semantics: the admin job view
 * validated every field, while `job-runner` did `value as PhaseResult[]` on any
 * array. The blind cast is what made the 2026-08-02 OpenAI outage hard to see
 * from the worker side — a malformed or partially-written row would have been
 * counted as a real phase record, and `isProviderFailedTarget` reads this data
 * to decide whether an outage gets alerted at all. The validating version wins.
 *
 * `providerFailure` is deliberately carried through: it is the only per-phase
 * signal distinguishing "the provider was down" from "this brand genuinely had
 * no data", and both the job summary (`summaryFromTargets`) and the Resume flow
 * depend on it surviving the JSON round-trip.
 *
 * Unknown/extra fields are dropped rather than passed through, so a stale row
 * written by an older deploy can never widen the shape callers see.
 */
export function parsePhaseResults(value: Json): PhaseResult[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    if (typeof item.phase !== "string" || typeof item.status !== "string")
      return [];
    if (!PHASE_STATUSES.includes(item.status)) return [];

    const imagePool = parseImagePool(item.imagePool);

    return [
      {
        phase: item.phase,
        status: item.status as PhaseResultStatus,
        changedFields: Array.isArray(item.changedFields)
          ? item.changedFields.filter(
              (field): field is string => typeof field === "string",
            )
          : [],
        durationMs: typeof item.durationMs === "number" ? item.durationMs : 0,
        ...(typeof item.error === "string" ? { error: item.error } : {}),
        ...(typeof item.detail === "string" ? { detail: item.detail } : {}),
        ...(item.providerFailure === true ? { providerFailure: true } : {}),
        ...(typeof item.catalogZeroReason === "string" ? { catalogZeroReason: item.catalogZeroReason } : {}),
        ...(typeof item.productsProposed === "number" ? { productsProposed: item.productsProposed } : {}),
        ...(typeof item.agentOutcome === "string" && VALID_AGENT_OUTCOMES.includes(item.agentOutcome) ? { agentOutcome: item.agentOutcome as PhaseResult["agentOutcome"] } : {}),
        ...(isPlainObject(item.acquisitionPlan) && JSON.stringify(item.acquisitionPlan).length <= 8192 ? { acquisitionPlan: item.acquisitionPlan as Record<string, unknown> } : {}),
        ...(isPlainObject(item.productsVerification) && JSON.stringify(item.productsVerification).length <= 8192 ? { productsVerification: item.productsVerification as Record<string, unknown> } : {}),
        ...(Array.isArray(item.revokedColumns) ? { revokedColumns: item.revokedColumns.filter((c: unknown): c is string => typeof c === 'string') } : {}),
        ...(imagePool ? { imagePool } : {}),
      },
    ];
  });
}
