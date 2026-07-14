import {
  ENRICH_PHASES,
  createEnrichmentSummary,
  runEnrich,
  type OperationResult as CurationOperationResult,
} from "@/lib/services/curation-operations";
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
import {
  enrichedDataFromDb,
  hasCompleteEnrichment,
} from "@/lib/types/enriched-data";

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

    return summary;
  } catch (error) {
    const message = sanitizeJobError(error);
    const failed = await finalizeCurationJob(job.id, workerToken, {
      status: "failed",
      completed_at: new Date().toISOString(),
      job_error: message,
      result: {
        status: "failed",
        error: message,
      } as Json,
    });

    if (failed && job.trigger !== "automatic_retry" && job.attempt === 1) {
      await enqueueAutomaticRetry(job);
    }

    return failedJobSummary(job, message, Date.now() - startedAt);
  } finally {
    clearInterval(heartbeat);
  }
}

async function runOperation(
  supabase: Supabase,
  job: CurationJob,
  workerToken: string,
): Promise<OperationWithSummary> {
  const operation = parseOperation(job.operation);
  const targets = await filterManualRerunTargets(
    supabase,
    job,
    workerToken,
    await listCurationJobTargets(job.id),
  );
  const params = paramsForTargets(parseParams(job.params), targets);
  if (targets.length === 0) {
    return attachEnrichmentSummary(emptyOperationResult(), 0);
  }
  const config = {
    dryRun: job.dry_run,
    slugs: params.slugs,
    limit: params.stopAfter,
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
    status: parseStatus(raw.status),
  };
}

async function runSubmissionEnrichment(
  supabase: Supabase,
  params: JobParams,
  config: JobTargetProgressConfig,
): Promise<OperationWithSummary> {
  const startedAt = Date.now();
  const submissionIds = params.submissionIds ?? [];
  const result: CurationOperationResult = {
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    brandOutcomes: [],
  };
  const { data, error } = await supabase
    .from("brand_submissions")
    .select("id, brand_id, brand_name")
    .in("id", submissionIds);

  if (error) {
    throw error;
  }

  const submissions = (data ?? []) as Array<{
    id: string;
    brand_id: string | null;
    brand_name: string;
  }>;
  const linkedBrandIds = submissions
    .map((submission) => submission.brand_id)
    .filter((brandId): brandId is string => Boolean(brandId));
  const directSubmissions = submissions.filter(
    (submission) => !submission.brand_id,
  );
  const slugs = await getBrandSlugsForIds(supabase, linkedBrandIds);
  const brandSlugs = [...new Set([...(params.slugs ?? []), ...slugs])];

  if (brandSlugs.length > 0) {
    const brandResult = await runEnrich(
      {
        ...config,
        slugs: brandSlugs,
        status: params.status,
        phases: params.phases ?? config.phases ?? [...ENRICH_PHASES],
      },
      operationSupabase(supabase),
    );
    result.processed += brandResult.processed;
    result.updated += brandResult.updated;
    result.skipped += brandResult.skipped;
    result.errors.push(...brandResult.errors);
    result.brandOutcomes.push(...brandResult.brandOutcomes);
  }

  const directIds = directSubmissions.map((submission) => submission.id);
  if (directIds.length > 0) {
    const directResult = await runEnrich(
      {
        ...config,
        target: "submissions",
        submissionIds: directIds,
        status: params.status,
        phases: params.phases ?? config.phases ?? [...ENRICH_PHASES],
      },
      operationSupabase(supabase),
    );
    result.processed += directResult.processed;
    result.updated += directResult.updated;
    result.skipped += directResult.skipped;
    result.errors.push(...directResult.errors);
    result.brandOutcomes.push(...directResult.brandOutcomes);
  }

  return attachEnrichmentSummary(result, Date.now() - startedAt);
}

async function getBrandSlugsForIds(
  supabase: Supabase,
  brandIds: string[],
): Promise<string[]> {
  if (brandIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("brands")
    .select("slug")
    .in("id", brandIds);

  if (error) {
    throw error;
  }

  return ((data ?? []) as Array<{ slug: string | null }>)
    .map((brand) => brand.slug)
    .filter(
      (slug): slug is string => typeof slug === "string" && slug.trim() !== "",
    );
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

function parseEnrichPhases(value: unknown): EnrichPhase[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const phases = value.filter(
    (phase): phase is EnrichPhase =>
      typeof phase === "string" &&
      (ENRICH_PHASES as readonly string[]).includes(phase),
  );

  return phases.length > 0 ? [...new Set(phases)] : undefined;
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
          .select("id, status, brand_id, hero_image_url, enriched_data")
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
      else if (submission.status !== "pending" || submission.brand_id) {
        reason = "Submission was approved or changed before the rerun";
      } else {
        const enrichedData =
          submission.enriched_data &&
          typeof submission.enriched_data === "object" &&
          !Array.isArray(submission.enriched_data)
            ? enrichedDataFromDb(
                submission.enriched_data as Record<string, unknown>,
              )
            : null;
        if (hasCompleteEnrichment(enrichedData, submission.hero_image_url)) {
          reason = "Submission was already enriched before the rerun";
        }
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

function parsePhaseResults(value: Json): PhaseResult[] {
  return Array.isArray(value) ? (value as unknown as PhaseResult[]) : [];
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

export function sanitizeJobError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      "[REDACTED_JWT]",
    )
    .replace(
      /((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,;]+/gi,
      "$1[REDACTED]",
    )
    .replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/gi, "$1[REDACTED]@")
    .slice(0, 2_000);
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
