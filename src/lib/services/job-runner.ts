import {
  ENRICH_PHASES,
  createEnrichmentSummary,
  isLlmCircuitBreakerError,
  isProviderFailureMessage,
  runEnrich,
  type OperationResult as CurationOperationResult,
} from "@/lib/services/curation-operations";
import {
  CURATION_STEPS,
  type CurationStep,
} from "@/lib/constants/enrich-phases";
import {
  reportJobFailure,
  reportProviderFailures,
} from "@/lib/services/job-alerts";
import {
  logEnrichmentProgress,
  type EnrichmentSummary,
} from "@/lib/services/enrichment-logger";
import {
  enqueueAutomaticRetry,
  finalizeCurationJob,
  heartbeatCurationJob,
  JOB_HEARTBEAT_INTERVAL_MS,
  listCurationJobTargets,
  parseOverwriteParam,
  updateCurationJobTarget,
  type CurationJob,
  type CurationJobTarget,
} from "@/lib/services/curation-jobs";
import { createServiceClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import type {
  CurationTargetProgressEvent,
  PhaseResult,
} from "@/lib/types/curation";
import { parsePhaseResults } from "@/lib/services/phase-results";
import { sanitizeJobError } from "@/lib/services/job-errors";
import { exportJobRunLog } from "@/lib/services/runlog-export";
import { renderRunLogHtml } from "@/lib/runlog";
import { uploadRunLogSnapshot } from "@/lib/services/runlog-storage";

export { sanitizeJobError } from "@/lib/services/job-errors";

type Supabase = ReturnType<typeof createServiceClient>;
type OperationSupabase = Parameters<typeof runEnrich>[1];
type ValidOperation = "enrich";
type EnrichPhase = (typeof ENRICH_PHASES)[number];
type EnrichTarget = "brands" | "submissions";
type BrandStatus = "approved" | "hidden";

type JobParams = {
  slugs?: string[];
  submissionIds?: string[];
  target?: EnrichTarget;
  stopAfter?: number;
  phases?: EnrichPhase[];
  steps?: CurationStep[];
  overwrite?: boolean;
  status?: BrandStatus;
};
type OperationWithSummary = CurationOperationResult & {
  enrichmentSummary: EnrichmentSummary;
};
type JobTargetProgressConfig = {
  dryRun: boolean;
  slugs?: string[];
  limit?: number;
  phases?: EnrichPhase[];
  overwrite?: boolean;
  onProgress?: (message: string) => void;
  onTargetProgress?: (
    event: CurationTargetProgressEvent,
  ) => void | Promise<void>;
  onTargetProgressBatch?: (
    events: CurationTargetProgressEvent[],
  ) => void | Promise<void>;
  jobId?: string;
};
type TargetProgressPatch = {
  target_id: string;
  status: CurationTargetProgressEvent["status"];
  current_phase: string | null;
  phase_results?: Json;
  changed_fields?: string[];
  error?: string;
  completed_at?: string;
  duration_ms?: number;
};

export async function runJob(
  job: CurationJob,
  workerToken: string,
): Promise<EnrichmentSummary> {
  const startedAt = Date.now();
  let heartbeatInFlight = false;
  let leaseLost = false;
  const heartbeat = setInterval(async () => {
    if (heartbeatInFlight) return;
    heartbeatInFlight = true;
    try {
      leaseLost = !(await heartbeatCurationJob(job.id, workerToken));
    } catch (error) {
      console.error("[curation-worker:heartbeat]", sanitizeJobError(error));
    } finally {
      heartbeatInFlight = false;
    }
  }, JOB_HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  try {
    await runOperation(createServiceClient(), job, workerToken);
    await markUnreportedTargetsSkipped(job.id, workerToken);
    const targets = await listCurationJobTargets(job.id);
    const summary = summaryFromTargets(targets, Date.now() - startedAt);
    if (leaseLost) {
      throw new Error("Job lease was lost before completion");
    }

    const completed = await finalizeCurationJob(job.id, workerToken, {
      status: "completed",
      completed_at: new Date().toISOString(),
      progress: progressJson(targets),
      result: summary as unknown as Json,
      target_total: targets.length,
      succeeded_count: summary.success,
      skipped_count: summary.skipped,
      failed_count: summary.failed,
      job_error: null,
    });

    if (!completed) {
      throw new Error("Job lease was lost before completion");
    }

    await archiveRunLog(job.id);
    // A search-provider outage never throws — it finalizes right here, as a
    // `completed` job carrying failed targets. This is the only reachable alert
    // path for it; the catch below only sees process-level crashes.
    await reportProviderFailures(job, summary);
    return summary;
  } catch (error) {
    const message = sanitizeJobError(error);
    // The LLM circuit breaker fired. `runEnrich` only throws this after the
    // in-flight chunk has fully drained, so nothing is still writing target
    // rows and a plain update is safe. Cancelling the untouched targets is what
    // stops the automatic retry below from re-running them against the same
    // dead account — `enqueueAutomaticRetry` re-runs `pending|running` only.
    if (isLlmCircuitBreakerError(error)) {
      await cancelUnstartedTargets(job.id, message);
    }
    const failed = await finalizeCurationJob(job.id, workerToken, {
      status: "failed",
      completed_at: new Date().toISOString(),
      job_error: message,
      result: {
        status: "failed",
        error: message,
      } as Json,
    });

    if (failed) {
      await archiveRunLog(job.id);
      if (job.trigger !== "automatic_retry" && job.attempt === 1) {
        await enqueueAutomaticRetry(job);
      }
    }

    await reportJobFailure(job, message);

    return failedJobSummary(job, message, Date.now() - startedAt);
  } finally {
    clearInterval(heartbeat);
  }
}

async function archiveRunLog(jobId: string): Promise<void> {
  try {
    const runlog = await exportJobRunLog(jobId);
    await uploadRunLogSnapshot(jobId, renderRunLogHtml(runlog));
  } catch (error) {
    console.error("[curation-worker:runlog]", {
      jobId,
      error: sanitizeJobError(error),
    });
  }
}

async function runOperation(
  supabase: Supabase,
  job: CurationJob,
  workerToken: string,
): Promise<OperationWithSummary> {
  const operation = parseOperation(job.operation);
  const storedTargets = await listCurationJobTargets(job.id);
  if (storedTargets.some((target) => target.target_type === "brand")) {
    throw new Error(
      "Brand-target enrichment jobs are retired; request a refresh submission",
    );
  }
  const targets = await filterManualRerunTargets(
    supabase,
    job,
    workerToken,
    storedTargets,
  );
  const params = paramsForTargets(parseParams(job.params), targets);
  if (targets.length === 0) {
    return attachEnrichmentSummary(emptyOperationResult(), 0);
  }
  const config = {
    dryRun: job.dry_run,
    slugs: params.slugs,
    limit: params.stopAfter,
    overwrite: params.overwrite,
    onProgress: logEnrichmentProgress,
    onTargetProgress: (event: CurationTargetProgressEvent) =>
      persistTargetProgress(supabase, job, workerToken, event),
    onTargetProgressBatch: (events: CurationTargetProgressEvent[]) =>
      persistTargetProgressBatch(supabase, job, workerToken, events),
    jobId: job.id,
  };
  let result: OperationWithSummary;
  const status = params.status;

  switch (operation) {
    case "enrich":
      if (params.submissionIds && params.submissionIds.length > 0) {
        result = await runSubmissionEnrichment(supabase, params, config);
        break;
      }

      result = await runEnrich(
        {
          ...config,
          target:
            params.target ?? (params.slugs?.length ? "brands" : "submissions"),
          status,
          phases: params.phases ?? [...ENRICH_PHASES],
          ...(params.steps ? { steps: params.steps } : {}),
          jobId: job.id,
        },
        operationSupabase(supabase),
      );
      break;
    default:
      throw new Error(`Unhandled operation: ${operation}`);
  }

  return result;
}

function parseOperation(operation: string): ValidOperation {
  if (operation === "enrich") {
    return operation;
  }

  if (
    [
      "clean-names",
      "normalize-slugs",
      "detect-non-brands",
      "enrich-descriptions",
      "enrich-links",
      "enrich-images",
      "score-and-scrape",
      "set-visibility",
    ].includes(operation)
  ) {
    console.warn(
      `[admin:run-job] Deprecated operation requested: ${operation}`,
    );
    throw new Error("Operation removed — use enrich instead");
  }

  throw new Error(`Unsupported operation: ${operation}`);
}

function parseParams(params: Json | null): JobParams {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return {};
  }

  const raw = params as Record<string, unknown>;
  const slugs = Array.isArray(raw.slugs)
    ? raw.slugs.filter(
        (slug): slug is string =>
          typeof slug === "string" && slug.trim() !== "",
      )
    : undefined;
  const submissionIds = Array.isArray(raw.submissionIds)
    ? raw.submissionIds.filter(
        (id): id is string => typeof id === "string" && id.trim() !== "",
      )
    : undefined;
  const target = parseTarget(raw.target);
  const stopAfter =
    typeof raw.stopAfter === "number" &&
    Number.isFinite(raw.stopAfter) &&
    raw.stopAfter > 0
      ? Math.floor(raw.stopAfter)
      : undefined;

  return {
    slugs,
    submissionIds,
    target,
    stopAfter,
    phases: parseEnrichPhases(raw.phases),
    steps: parseCurationSteps(raw.steps),
    overwrite: parseOverwriteParam(raw.overwrite),
    status: parseStatus(raw.status),
  };
}

async function runSubmissionEnrichment(
  supabase: Supabase,
  params: JobParams,
  config: JobTargetProgressConfig,
): Promise<OperationWithSummary> {
  const submissionIds = params.submissionIds ?? [];
  const directResult = await runEnrich(
    {
      ...config,
      target: "submissions",
      submissionIds,
      status: params.status,
      phases: params.phases ?? config.phases ?? [...ENRICH_PHASES],
      ...(params.steps ? { steps: params.steps } : {}),
    },
    operationSupabase(supabase),
  );

  return directResult;
}

const BRAND_STATUSES: readonly BrandStatus[] = ["approved", "hidden"];
const ENRICH_TARGETS: readonly EnrichTarget[] = ["brands", "submissions"];

function parseTarget(value: unknown): EnrichTarget | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return ENRICH_TARGETS.includes(trimmed as EnrichTarget)
    ? (trimmed as EnrichTarget)
    : undefined;
}

function parseStatus(value: unknown): BrandStatus | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return BRAND_STATUSES.includes(trimmed as BrandStatus)
    ? (trimmed as BrandStatus)
    : undefined;
}

/**
 * Historical jobs (and automatic retries of them) store `expansion` — the name
 * the reputation phase had until 2026-08-03. Mapping it BEFORE validation is
 * what keeps such a job at its original scope: the filter below drops unknown
 * names, so an unmapped `expansion` would silently shrink the run instead of
 * failing loudly.
 */
export function normalizeLegacyEnrichPhase(phase: string): string {
  return phase === "expansion" ? "reputation" : phase;
}

function parseEnrichPhases(value: unknown): EnrichPhase[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const phases = value
    .map((phase) =>
      typeof phase === "string" ? normalizeLegacyEnrichPhase(phase) : phase,
    )
    .filter(
      (phase): phase is EnrichPhase =>
        typeof phase === "string" &&
        (ENRICH_PHASES as readonly string[]).includes(phase),
    );

  return phases.length > 0 ? [...new Set(phases)] : undefined;
}

/**
 * Steps are what the admin UI now sends. Unknown names are dropped rather than
 * failing the job, mirroring `parseEnrichPhases`; an all-unknown list yields
 * undefined so the stored `phases` (or the full pipeline) still applies.
 */
function parseCurationSteps(value: unknown): CurationStep[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const known = Object.keys(CURATION_STEPS) as CurationStep[];
  const steps = value.filter(
    (step): step is CurationStep =>
      typeof step === "string" && (known as readonly string[]).includes(step),
  );

  return steps.length > 0 ? [...new Set(steps)] : undefined;
}

function progressJson(targets: CurationJobTarget[]): Json {
  const succeeded = targets.filter(
    (target) => target.status === "succeeded",
  ).length;
  const skipped = targets.filter(
    (target) => target.status === "skipped",
  ).length;
  const failed = targets.filter((target) => target.status === "failed").length;

  return {
    processed: succeeded + skipped + failed,
    total: targets.length,
    succeeded,
    skipped,
    failed,
  } as Json;
}

function paramsForTargets(
  params: JobParams,
  targets: CurationJobTarget[],
): JobParams {
  const submissionIds = targets
    .filter((target) => target.target_type === "submission")
    .map((target) => target.target_id);
  const slugs = targets
    .filter((target) => target.target_type === "brand")
    .map((target) => target.brand_slug)
    .filter((slug): slug is string => Boolean(slug));

  return {
    ...params,
    submissionIds: submissionIds.length > 0 ? submissionIds : undefined,
    slugs: slugs.length > 0 ? slugs : undefined,
    target:
      submissionIds.length > 0
        ? "submissions"
        : slugs.length > 0
          ? "brands"
          : params.target,
  };
}

async function persistTargetProgress(
  supabase: Supabase,
  job: CurationJob,
  workerToken: string,
  event: CurationTargetProgressEvent,
): Promise<void> {
  await persistTargetProgressBatch(supabase, job, workerToken, [event]);
}

async function persistTargetProgressBatch(
  supabase: Supabase,
  job: CurationJob,
  workerToken: string,
  events: CurationTargetProgressEvent[],
): Promise<void> {
  if (events.length === 0) return;

  const updates = events.map(buildTargetProgressPatch);
  const lastEvent = events.at(-1);
  if (!lastEvent) return;

  if (typeof supabase.rpc !== "function") {
    if (process.env.NODE_ENV !== "test") {
      throw new Error("Curation job progress RPC is unavailable");
    }

    for (const [index, event] of events.entries()) {
      const patch = updates.at(index);
      if (!patch) continue;
      await updateCurationJobTarget(job.id, event.targetId, {
        status: event.status,
        current_phase: event.currentPhase ?? null,
        ...(patch.phase_results !== undefined && {
          phase_results: patch.phase_results,
        }),
        ...(patch.changed_fields !== undefined && {
          changed_fields: patch.changed_fields,
        }),
        ...(patch.error !== undefined && { error: patch.error }),
        ...(patch.completed_at !== undefined && {
          completed_at: patch.completed_at,
        }),
        ...(patch.duration_ms !== undefined && {
          duration_ms: patch.duration_ms,
        }),
      });
    }

    const ownsLease = await heartbeatCurationJob(job.id, workerToken, {
      targetId: lastEvent.status === "running" ? lastEvent.targetId : null,
      phase:
        lastEvent.status === "running"
          ? (lastEvent.currentPhase ?? null)
          : null,
    });
    if (!ownsLease) {
      throw new Error("Job lease was lost while persisting target progress");
    }
    return;
  }

  const { data, error } = await supabase.rpc(
    "persist_curation_job_target_progress",
    {
      p_job_id: job.id,
      p_worker_token: workerToken,
      p_updates: updates as unknown as Json,
      p_current_target_id:
        lastEvent.status === "running" ? lastEvent.targetId : null,
      p_current_phase:
        lastEvent.status === "running"
          ? (lastEvent.currentPhase ?? null)
          : null,
    },
  );

  if (error) throw error;
  if (!data) {
    throw new Error("Job lease was lost while persisting target progress");
  }
}

function buildTargetProgressPatch(
  event: CurationTargetProgressEvent,
): TargetProgressPatch {
  const isTerminal = event.status !== "running";

  return {
    target_id: event.targetId,
    status: event.status,
    current_phase: event.currentPhase ?? null,
    ...(event.phaseResults !== undefined && {
      phase_results: sanitizePhaseResults(
        event.phaseResults,
      ) as unknown as Json,
    }),
    ...(event.changedFields !== undefined && {
      changed_fields: event.changedFields,
    }),
    ...(event.error !== undefined && {
      error: sanitizeJobError(event.error),
    }),
    ...(isTerminal && {
      completed_at: new Date().toISOString(),
      duration_ms: Math.max(0, Math.round(event.durationMs ?? 0)),
    }),
  };
}

/**
 * Sweeps every target the breaker prevented from running to `cancelled`.
 *
 * A direct service-client update rather than the `cancel_curation_job` RPC on
 * purpose: that RPC sets the JOB to `cancelled` and nulls `worker_token`, which
 * would fight the `finalizeCurationJob(status: 'failed')` call immediately
 * after it and lose the lease. The job must finalize `failed` carrying the
 * breaker message; only its targets become `cancelled`, which is also what
 * makes them eligible for a later Resume.
 *
 * A sweep failure is logged, never rethrown — losing the job's own `failed`
 * finalization because the cleanup update failed would be strictly worse.
 */
async function cancelUnstartedTargets(
  jobId: string,
  reason: string,
): Promise<void> {
  try {
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("curation_job_targets")
      .update({
        status: "cancelled",
        current_phase: null,
        error: reason,
        completed_at: new Date().toISOString(),
      })
      .eq("job_id", jobId)
      .in("status", ["pending", "running"]);

    if (error) throw error;
  } catch (error) {
    console.error("[curation-worker:breaker-sweep]", sanitizeJobError(error));
  }
}

async function markUnreportedTargetsSkipped(
  jobId: string,
  workerToken: string,
): Promise<void> {
  const supabase = createServiceClient();

  if (typeof supabase.rpc === "function") {
    const { data, error } = await supabase.rpc(
      "mark_unreported_curation_job_targets_skipped",
      { p_job_id: jobId, p_worker_token: workerToken },
    );

    if (error) throw error;
    if (!data) {
      throw new Error("Job lease was lost while marking targets skipped");
    }
    return;
  }

  if (process.env.NODE_ENV !== "test") {
    throw new Error("Curation job progress RPC is unavailable");
  }

  const { error } = await supabase
    .from("curation_job_targets")
    .update({
      status: "skipped",
      current_phase: null,
      error: "Target is no longer pending or requires no enrichment",
      completed_at: new Date().toISOString(),
    })
    .eq("job_id", jobId)
    .in("status", ["pending", "running"]);

  if (error) throw error;
}

async function filterManualRerunTargets(
  supabase: Supabase,
  job: CurationJob,
  workerToken: string,
  targets: CurationJobTarget[],
): Promise<CurationJobTarget[]> {
  if (job.trigger !== "manual_rerun" || targets.length === 0) return targets;

  const submissionIds = targets
    .filter((target) => target.target_type === "submission")
    .map((target) => target.target_id);
  const brandIds = targets
    .filter((target) => target.target_type === "brand")
    .map((target) => target.target_id);
  const [submissionResult, brandResult] = await Promise.all([
    submissionIds.length
      ? supabase
          .from("brand_submissions")
          .select("id, status")
          .in("id", submissionIds)
      : Promise.resolve({ data: [], error: null }),
    brandIds.length
      ? supabase
          .from("brands")
          .select("id, brand_enriched_at")
          .in("id", brandIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (submissionResult.error) throw submissionResult.error;
  if (brandResult.error) throw brandResult.error;

  const submissions = new Map(
    (submissionResult.data ?? []).map((row) => [row.id, row]),
  );
  const brands = new Map((brandResult.data ?? []).map((row) => [row.id, row]));
  const skipReasons = new Map<string, CurationJobTarget[]>();

  for (const target of targets) {
    let reason: string | null = null;
    if (target.target_type === "submission") {
      const submission = submissions.get(target.target_id);
      if (!submission) reason = "Submission was deleted before the rerun";
      else if (submission.status !== "pending") {
        reason = "Submission was approved or changed before the rerun";
      }
    } else {
      const brand = brands.get(target.target_id);
      if (!brand) reason = "Brand was deleted before the rerun";
      else if (brand.brand_enriched_at)
        reason = "Brand was already enriched before the rerun";
    }

    if (reason) {
      skipReasons.set(reason, [...(skipReasons.get(reason) ?? []), target]);
    }
  }

  if (skipReasons.size > 0) {
    const events = [...skipReasons.entries()].flatMap(
      ([reason, skippedTargets]) =>
        skippedTargets.map((target) => ({
          targetId: target.target_id,
          targetType: target.target_type,
          slug: target.brand_slug ?? `submission-${target.target_id}`,
          name: target.brand_name,
          status: "skipped" as const,
          currentPhase: undefined,
          phaseResults: [
            {
              phase: "preflight",
              status: "skipped" as const,
              changedFields: [],
              durationMs: 0,
              detail: reason,
            },
          ],
          changedFields: [],
          error: reason,
          durationMs: 0,
        })),
    );
    await persistTargetProgressBatch(supabase, job, workerToken, events);
  }

  const skippedIds = new Set(
    [...skipReasons.values()].flatMap((skippedTargets) =>
      skippedTargets.map((target) => target.id),
    ),
  );
  return targets.filter((target) => !skippedIds.has(target.id));
}

function summaryFromTargets(
  targets: CurationJobTarget[],
  durationMs: number,
): EnrichmentSummary {
  const failedTargets = targets.filter((target) => target.status === "failed");

  return {
    success: targets.filter((target) => target.status === "succeeded").length,
    skipped: targets.filter((target) => target.status === "skipped").length,
    failed: failedTargets.length,
    providerFailed: failedTargets.filter(isProviderFailedTarget).length,
    failedBrands: failedTargets.map((target) => {
      const phaseResults = parsePhaseResults(target.phase_results);
      const failedPhase = phaseResults.find(
        (phaseResult) => phaseResult.status === "failed",
      );
      return {
        slug: target.brand_slug ?? target.brand_name,
        phase: failedPhase?.phase ?? target.current_phase ?? "brand",
        error: failedPhase?.error ?? target.error ?? "Unknown enrichment error",
      };
    }),
    durationMs,
  };
}

/**
 * A failed target counts as a provider failure when the per-brand loop tagged
 * its phase result (`providerFailure`) — or, as a fallback for targets written
 * before that flag existed, when the persisted error still carries the Gate A
 * or Gate C marker (`isProviderFailureMessage` accepts either prefix, so an
 * OpenAI outage is counted and alerted exactly like a Serper one).
 * Both signals live in the `curation_job_targets` row, so this works
 * identically whether the job ran in the Next runtime or the worker container.
 */
function isProviderFailedTarget(target: CurationJobTarget): boolean {
  const phaseResults = parsePhaseResults(target.phase_results);

  return (
    phaseResults.some(
      (phaseResult) =>
        phaseResult.providerFailure === true ||
        isProviderFailureMessage(phaseResult.error),
    ) || isProviderFailureMessage(target.error)
  );
}

function sanitizePhaseResults(phaseResults: PhaseResult[]): PhaseResult[] {
  return phaseResults.map((phaseResult) => ({
    ...phaseResult,
    ...(phaseResult.error
      ? { error: sanitizeJobError(phaseResult.error) }
      : {}),
    ...(phaseResult.detail
      ? { detail: phaseResult.detail.slice(0, 1_000) }
      : {}),
  }));
}

function emptyOperationResult(): CurationOperationResult {
  return {
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    brandOutcomes: [],
  };
}

function failedJobSummary(
  job: CurationJob,
  error: string,
  durationMs: number,
): EnrichmentSummary {
  return {
    success: 0,
    skipped: 0,
    failed: 1,
    providerFailed: isProviderFailureMessage(error) ? 1 : 0,
    failedBrands: [{ slug: job.id, phase: "job", error }],
    durationMs,
  };
}

function attachEnrichmentSummary(
  result: CurationOperationResult,
  durationMs: number,
): OperationWithSummary {
  return {
    ...result,
    enrichmentSummary: createEnrichmentSummary(result, durationMs),
  };
}

function operationSupabase(supabase: Supabase): OperationSupabase {
  return supabase as unknown as OperationSupabase;
}
