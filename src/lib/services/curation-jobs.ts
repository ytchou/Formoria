import {
  buildRecoveryPlan,
  readTargetPlan,
  validateRecoveryPlan,
  type RecoveryPlan,
} from "./enrich-blocks/plan";
import {
  createSupabasePhaseOutputStore,
  isUsablePhaseCheckpoint,
  isUsablePhaseOutput,
} from "./enrich-blocks/phase-outputs";
import { restoreAcquireCheckpoint } from "./enrich-blocks/hydration";
import { mapWithConcurrency } from "./_shared/concurrency";
import { createServiceClient } from "@/lib/supabase/service";
import { auditedCall } from "@/lib/audit";
import type { Database, Json } from "@/lib/supabase/database.types";
import {
  ENRICH_PHASES,
  normalizeRequestedPhases,
  type EnrichPhaseName,
  type RetryParams,
} from "@/lib/constants/enrich-phases";
import { computeBackoffDelay, JOB_REQUEUE, RETRY_ATTEMPTS } from "@/lib/retry";
import {
  lastAcquireRecordedBudgetExhausted,
  parsePhaseResults,
} from "@/lib/services/phase-results";
import { imagePathToUrl } from "@/lib/images/image-url";
import {
  enrichedDataFromDb,
  hasCompleteEnrichment,
} from "@/lib/types/enriched-data";

export const JOB_HEARTBEAT_INTERVAL_MS = 30_000;
const JOB_STALE_AFTER_MS = 10 * 60_000;
const CURATION_TARGET_PAGE_SIZE = 1_000;
const SUPABASE_IN_FILTER_CHUNK_SIZE = 200;

type CurationJobStatus =
  "pending" | "running" | "completed" | "failed" | "cancelled";
export type CurationDispatchStatus = "pending" | "dispatched" | "failed";
type CurationJobTrigger = "admin" | "cron" | "automatic_retry" | "manual_rerun";
export type CurationTargetStatus =
  "pending" | "running" | "succeeded" | "skipped" | "failed" | "cancelled";
type CurationTargetType = "submission" | "brand";

export type CurationJobParams = Record<string, Json | undefined> & {
  slugs?: string[];
  submissionIds?: string[];
  stopAfter?: number;
  /**
   * Execution vocabulary, still accepted and still what historical rows carry.
   * Explicit phases take highest precedence when present.
   */
  phases?: string[];
  /** Task-based selection. Resolves to a phase closure via the dependency map. */
  task?: string;
  /** Legacy step names from stored rows. Parsed into phases as a fallback. */
  steps?: string[];
  overwrite?: boolean;
  status?: string;
  target?: "submissions" | "brands";
  /** Multiplier for the per-brand time budget. >1 grants more time. */
  budgetScale?: number;
  /** Block-level retry scope from the admin UI (DEV-1611). */
  retry?: RetryParams | RecoveryPlan;
};

type CurationJobRow = Database["public"]["Tables"]["curation_jobs"]["Row"];
type CurationJobTargetRow =
  Database["public"]["Tables"]["curation_job_targets"]["Row"];

export type CurationJob = Omit<
  CurationJobRow,
  "status" | "trigger" | "operation" | "dispatch_status" | "cancelled_count"
> & {
  operation: "enrich";
  status: CurationJobStatus;
  trigger: CurationJobTrigger;
  dispatch_status: CurationDispatchStatus;
  cancelled_count?: number;
};

export type CurationJobTarget = Omit<
  CurationJobTargetRow,
  "status" | "target_type"
> & {
  status: CurationTargetStatus;
  target_type: CurationTargetType;
};

type EnqueueTarget = {
  targetType: CurationTargetType;
  targetId: string;
  brandName: string;
  brandSlug: string | null;
};

type EnqueueCurationJobInput = {
  operation: "enrich";
  params: CurationJobParams;
  dryRun: boolean;
  startedBy: string;
  trigger: CurationJobTrigger;
  targets: EnqueueTarget[];
  parentJobId?: string | null;
  attempt?: number;
  scheduledFor?: string | null;
  runAfter?: string;
  dedupeKey?: string | null;
};

export type CurationJobDetail = {
  job: CurationJob;
  targets: CurationJobTarget[];
  parent: CurationJob | null;
  children: CurationJob[];
};

type CurationJobCursor = {
  createdAt: string;
  id: string;
};

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

export type CurationJobPage = {
  jobs: CurationJob[];
  nextCursor: string | null;
  previousCursor: string | null;
  total: number;
};

async function enqueueCurationJob(
  input: EnqueueCurationJobInput,
): Promise<CurationJob> {
  const supabase = createServiceClient();
  const { data: jobId, error } = await supabase.rpc("enqueue_curation_job", {
    p_operation: input.operation,
    p_params: input.params as Json,
    p_dry_run: input.dryRun,
    p_started_by: input.startedBy,
    p_trigger: input.trigger,
    p_parent_job_id: input.parentJobId ?? null,
    p_attempt: input.attempt ?? 1,
    p_scheduled_for: input.scheduledFor ?? null,
    p_run_after: input.runAfter ?? new Date().toISOString(),
    p_dedupe_key: input.dedupeKey ?? null,
    p_targets: input.targets.map((target) => ({
      target_type: target.targetType,
      target_id: target.targetId,
      brand_name: target.brandName,
      brand_slug: target.brandSlug,
    })) as Json,
  });

  if (error) throw error;

  return getCurationJob(jobId);
}

export async function enqueueAdminCurationJob(input: {
  params: CurationJobParams;
  dryRun: boolean;
  startedBy: string;
}): Promise<CurationJob> {
  return auditedCall(
    { provider: "curation", operation: "enqueueAdminCurationJob", kind: "service" },
    async () => {
      const targets = await resolveTargets(input.params);

      return enqueueCurationJob({
        operation: "enrich",
        params: input.params,
        dryRun: input.dryRun,
        startedBy: input.startedBy,
        trigger: "admin",
        targets,
      });
    },
  );
}

export async function enqueueScheduledSubmissionJob(
  scheduledFor: Date,
): Promise<CurationJob> {
  return auditedCall(
    { provider: "curation", operation: "enqueueScheduledSubmissionJob", kind: "service" },
    async () => {
      const targets = await resolvePendingSubmissionTargets();
      const scheduledIso = scheduledFor.toISOString();

      return enqueueCurationJob({
        operation: "enrich",
        params: { target: "submissions" },
        dryRun: false,
        startedBy: "railway-cron",
        trigger: "cron",
        targets,
        scheduledFor: scheduledIso,
        dedupeKey: `submission-enrichment:${scheduledIso}`,
      });
    },
  );
}

export async function claimNextCurationJob(
  workerToken: string,
): Promise<CurationJob | null> {
  return auditedCall(
    { provider: "curation", operation: "claimNextCurationJob", kind: "service" },
    async () => {
      const supabase = createServiceClient();
      const { data, error } = await supabase.rpc("claim_next_curation_job", {
        p_worker_token: workerToken,
      });

      if (error) throw error;

      return data[0] ? (data[0] as CurationJob) : null;
    },
  );
}

export async function claimCurationDispatchWork(
  requestedJobId: string,
  workerToken: string,
): Promise<{
  requestedJob: CurationJob;
  claimedJob: CurationJob | null;
} | null> {
  return auditedCall(
    { provider: "curation", operation: "claimCurationDispatchWork", kind: "service" },
    async () => {
      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from("curation_jobs")
        .select("*")
        .eq("id", requestedJobId)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      const requestedJob = data as CurationJob;
      if (requestedJob.status !== "pending") {
        return { requestedJob, claimedJob: null };
      }

      return {
        requestedJob,
        claimedJob: await claimNextCurationJob(workerToken),
      };
    },
  );
}

export async function claimCurationJob(
  jobId: string,
  workerToken: string,
): Promise<CurationJob | null> {
  return auditedCall(
    { provider: "curation", operation: "claimCurationJob", kind: "service" },
    async () => {
      const supabase = createServiceClient();
      const { data, error } = await supabase.rpc("claim_curation_job", {
        p_job_id: jobId,
        p_worker_token: workerToken,
      });

      if (error) throw error;

      return data[0] ? (data[0] as CurationJob) : null;
    },
  );
}

export async function markCurationJobDispatched(jobId: string): Promise<void> {
  return auditedCall(
    { provider: "curation", operation: "markCurationJobDispatched", kind: "service" },
    async () => {
      const supabase = createServiceClient();
      const { error } = await supabase
        .from("curation_jobs")
        .update({
          dispatch_status: "dispatched",
          dispatch_error: null,
          dispatched_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .in("status", ["pending", "running"]);

      if (error) throw error;
    },
  );
}

export async function recordCurationDispatchFailure(
  jobId: string,
  errorMessage: string,
): Promise<void> {
  return auditedCall(
    { provider: "curation", operation: "recordCurationDispatchFailure", kind: "service" },
    async () => {
      const supabase = createServiceClient();
      const { error } = await supabase
        .from("curation_jobs")
        .update({
          status: "failed",
          dispatch_status: "failed",
          dispatch_error: errorMessage,
          completed_at: new Date().toISOString(),
          job_error: errorMessage,
          result: { status: "failed", reason: "dispatch_failed" },
        })
        .eq("id", jobId)
        .eq("status", "pending")
        .select("id");

      if (error) throw error;
    },
  );
}

export async function recoverStaleJobs(): Promise<CurationJob[]> {
  return auditedCall(
    { provider: "curation", operation: "recoverStaleJobs", kind: "service" },
    async () => {
      const supabase = createServiceClient();
      const staleBefore = new Date(Date.now() - JOB_STALE_AFTER_MS).toISOString();
      const { data, error } = await supabase.rpc("recover_stale_curation_jobs", {
        p_stale_before: staleBefore,
      });

      if (error) throw error;

      return (data ?? []) as CurationJob[];
    },
  );
}

export async function ensureAutomaticRetries(): Promise<CurationJob[]> {
  return auditedCall(
    { provider: "curation", operation: "ensureAutomaticRetries", kind: "service" },
    async () => {
      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from("curation_jobs")
        .select("*")
        .eq("status", "failed")
        .in("dispatch_status", ["dispatched", "failed"])
        .lt("attempt", RETRY_ATTEMPTS)
        .order("completed_at", { ascending: true });

      if (error) throw error;

      const retries: CurationJob[] = [];
      for (const job of (data ?? []) as CurationJob[]) {
        const retry = await enqueueAutomaticRetry(job);
        if (retry) retries.push(retry);
      }

      return retries;
    },
  );
}

export async function enqueueAutomaticRetry(
  job: CurationJob,
): Promise<CurationJob | null> {
  if (job.attempt >= RETRY_ATTEMPTS) return null;

  return auditedCall(
    { provider: "curation", operation: "enqueueAutomaticRetry", kind: "service" },
    async () => {
      const targets = (
        await listCurationJobTargets(job.id, {
          excludeSucceeded: true,
        })
      ).filter(
        (target) => target.status === "pending" || target.status === "running",
      );
      if (targets.some((target) => target.target_type === "brand")) return null;
      if (targets.length === 0) return null;

      return enqueueCurationJob({
        operation: "enrich",
        params: parseJobParams(job.params),
        dryRun: job.dry_run,
        startedBy: "railway-worker",
        trigger: "automatic_retry",
        targets: targets.map(targetToEnqueueInput),
        parentJobId: job.id,
        attempt: job.attempt + 1,
        scheduledFor: job.scheduled_for,
        runAfter: new Date(
          Date.now() + computeBackoffDelay(JOB_REQUEUE, job.attempt - 1),
        ).toISOString(),
      });
    },
  );
}

export type CurationRecoveryAction =
  | { kind: "rerun"; overwrite?: boolean }
  | { kind: "resume" }
  | { kind: "phase"; targetId: string; retry: RetryParams };

export type CurationRecoveryInput = {
  sourceJobId: string;
  startedBy: string;
  action: CurationRecoveryAction;
};

export type CurationRecoveryCounts = {
  total: number;
  failed: number;
  cancelled: number;
};
export type CurationRecoveryResult = {
  job: CurationJob;
  counts: CurationRecoveryCounts;
};

export async function enqueueCurationRecovery({
  sourceJobId,
  startedBy,
  action,
}: CurationRecoveryInput): Promise<CurationRecoveryResult> {
  return auditedCall(
    {
      provider: "curation",
      operation: "enqueueCurationRecovery",
      kind: "service",
    },
    async () => {
      if (!action || !["rerun", "resume", "phase"].includes(action.kind))
        throw new Error("Invalid recovery action");
      const source = await getCurationJob(sourceJobId);
      const allTargets = await listCurationJobTargets(source.id);
      if (allTargets.some((target) => target.target_type === "brand")) {
        throw new Error(
          "Brand-target enrichment jobs are retired; request a refresh submission",
        );
      }
      const candidates =
        action.kind === "phase"
          ? allTargets.filter((target) => target.target_id === action.targetId)
          : allTargets;
      if (action.kind === "phase" && !candidates.length)
        throw new Error(
          `Target ${action.targetId} not found in job ${sourceJobId}`,
        );
      const supabase = createServiceClient();
      const pages = await mapWithConcurrency(
        chunkValues(
          candidates.map((target) => target.target_id),
          SUPABASE_IN_FILTER_CHUNK_SIZE,
        ),
        3,
        async (ids) => {
          const { data, error } = await supabase
            .from("brand_submissions")
            .select(
              "id, status, brand_id, hero_image_storage_path, enriched_data",
            )
            .in("id", ids);
          if (error) throw error;
          return data ?? [];
        },
      );
      const submissions = new Map(
        pages.flat().map((submission) => [submission.id, submission]),
      );
      const targets = candidates.filter((target) => {
        const submission = submissions.get(target.target_id);
        if (!submission || submission.status !== "pending") return false;
        if (action.kind === "phase") return true;
        if (action.kind === "resume")
          return target.status === "failed" || target.status === "cancelled";
        const data = submission.enriched_data;
        const enriched =
          data && typeof data === "object" && !Array.isArray(data)
            ? enrichedDataFromDb(data)
            : null;
        return isManualRerunTargetEligible({
          sourceStatus: source.status,
          targetStatus: target.status,
          isIncompleteSubmission:
            submission.brand_id === null &&
            !hasCompleteEnrichment(
              enriched,
              imagePathToUrl(submission.hero_image_storage_path),
            ),
        });
      });
      if (!targets.length)
        throw new Error("This job has no eligible pending targets to recover");
      const metadata: RecoveryPlan["action"] =
        action.kind === "phase"
          ? { ...action.retry, kind: "phase" }
          : { kind: action.kind };
      // Checkpoints are fetched once for the entire target set, never per target.
      const lineage =
        action.kind === "resume"
          ? new Set(await getCurationJobLineageIds(source.id))
          : new Set<string>();
      const rows =
        action.kind === "resume"
          ? await createSupabasePhaseOutputStore().reader.forTargets(
              targets.map((target) => ({
                id: target.target_id,
                type: "submission",
              })),
            )
          : [];
      const sourcePlans = new Map(targets.map((target) => [target.target_id, readTargetPlan(source.params, target.target_id)]));
      const retry = buildRecoveryPlan(
        source.params,
        metadata,
        targets.map((target) => ({
          id: target.target_id,
          status: target.status,
          results: parsePhaseResults(target.phase_results),
          reusablePhases: rows
            .filter((row) => {
              if (
                row.target_id !== target.target_id ||
                !lineage.has(row.job_id) ||
                row.persisted_at !== null ||
                !isUsablePhaseCheckpoint(row)
              )
                return false;
              if (row.job_id !== source.id && sourcePlans.get(target.target_id)?.forced.includes(row.phase as EnrichPhaseName)) return false;
              if (row.phase !== "acquire") return true;
              const carry = isUsablePhaseOutput(row.output)
                ? row.output.carry
                : undefined;
              return (
                !!carry &&
                "catalog" in carry &&
                !!restoreAcquireCheckpoint(carry)
              );
            })
            .map((row) => row.phase as EnrichPhaseName),
        })),
      );
      const params = recoveryJobParams(
        source.params,
        retry,
        action.kind === "rerun"
          ? {
              overwrite: action.overwrite,
              budgetScale: budgetScaleForRerun(targets),
            }
          : undefined,
      );
      const job = await enqueueCurationJob({
        operation: "enrich",
        params,
        dryRun: source.dry_run,
        startedBy,
        trigger: "manual_rerun",
        targets: targets.map(targetToEnqueueInput),
        parentJobId: source.id,
      });
      return {
        job,
        counts: {
          total: targets.length,
          failed: targets.filter((target) => target.status === "failed").length,
          cancelled: targets.filter((target) => target.status === "cancelled")
            .length,
        },
      };
    },
  );
}

export function isManualRerunTargetEligible({
  sourceStatus,
  targetStatus,
  isIncompleteSubmission,
}: {
  sourceStatus: CurationJobStatus;
  targetStatus: CurationTargetStatus;
  isIncompleteSubmission: boolean;
}): boolean {
  if (isIncompleteSubmission) return true;
  if (sourceStatus === "completed") {
    return targetStatus === "failed" || targetStatus === "skipped";
  }
  if (sourceStatus === "failed" || sourceStatus === "cancelled") {
    return ["pending", "running", "failed", "cancelled"].includes(targetStatus);
  }
  return false;
}

export async function heartbeatCurationJob(
  jobId: string,
  workerToken: string,
  current?: { targetId?: string | null; phase?: string | null },
): Promise<boolean> {
  return auditedCall(
    { provider: "curation", operation: "heartbeatCurationJob", kind: "service" },
    async () => {
      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from("curation_jobs")
        .update({
          heartbeat_at: new Date().toISOString(),
          ...(current && {
            current_target_id: current.targetId ?? null,
            current_phase: current.phase ?? null,
          }),
        })
        .eq("id", jobId)
        .eq("status", "running")
        .eq("worker_token", workerToken)
        .select("id");

      if (error) throw error;
      return (data?.length ?? 0) === 1;
    },
  );
}

export async function updateCurationJobTarget(
  jobId: string,
  targetId: string,
  patch: Database["public"]["Tables"]["curation_job_targets"]["Update"],
): Promise<void> {
  return auditedCall(
    { provider: "curation", operation: "updateCurationJobTarget", kind: "service" },
    async () => {
      const supabase = createServiceClient();
      const { error } = await supabase
        .from("curation_job_targets")
        .update(patch)
        .eq("job_id", jobId)
        .eq("target_id", targetId);

      if (error) throw error;
    },
  );
}

export async function finalizeCurationJob(
  jobId: string,
  workerToken: string,
  patch: Database["public"]["Tables"]["curation_jobs"]["Update"],
): Promise<boolean> {
  return auditedCall(
    { provider: "curation", operation: "finalizeCurationJob", kind: "service" },
    async () => {
      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from("curation_jobs")
        .update({
          ...patch,
          worker_token: null,
          current_target_id: null,
          current_phase: null,
          heartbeat_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .eq("status", "running")
        .eq("worker_token", workerToken)
        .select("id");

      if (error) throw error;
      return (data?.length ?? 0) === 1;
    },
  );
}

export async function listCurationJobs(options?: {
  limit?: number;
  cursor?: string;
  direction?: "next" | "previous";
  window?: { start: string; end: string };
}): Promise<CurationJobPage> {
  const supabase = createServiceClient();
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
  const direction = options?.direction ?? "next";
  const cursor = options?.cursor
    ? decodeCurationJobCursor(options.cursor)
    : null;
  const ascending = direction === "previous";
  let query = supabase
    .from("curation_jobs")
    .select("*", { count: "exact" })
    .order("created_at", { ascending })
    .order("id", { ascending });

  if (options?.window) {
    const { start, end } = options.window;
    query = query.or(
      `and(started_at.gte.${start},started_at.lt.${end}),and(started_at.is.null,completed_at.gte.${start},completed_at.lt.${end})`,
    );
  }

  if (cursor) {
    const comparator = direction === "previous" ? "gt" : "lt";
    query = query.or(
      `created_at.${comparator}.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.${comparator}.${cursor.id})`,
    );
  }

  const { data, error, count } = await query.limit(limit + 1);

  if (error) throw error;
  const rows = (data ?? []) as CurationJob[];
  const hasMore = rows.length > limit;
  const visible = rows.slice(0, limit);
  if (ascending) visible.reverse();

  return {
    jobs: visible,
    total: count ?? visible.length,
    previousCursor:
      cursor && visible[0] ? encodeCurationJobCursor(visible[0]) : null,
    nextCursor:
      (hasMore || direction === "previous") && visible.at(-1)
        ? encodeCurationJobCursor(visible.at(-1)!)
        : null,
  };
}

export async function getCurationJob(jobId: string): Promise<CurationJob> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("curation_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (error) throw error;
  return data as CurationJob;
}

/** Read once per recovery, shared by all of its targets. */
export async function getCurationJobLineageIds(sourceJobId: string): Promise<string[]> {
  const supabase = createServiceClient();
  const ids = new Set<string>();
  let nextId: string | null = sourceJobId;
  while (nextId) {
    if (ids.has(nextId)) throw new Error("Curation recovery lineage contains a cycle");
    const { data, error }: { data: { id: string; parent_job_id: string | null } | null; error: unknown } = await supabase
      .from("curation_jobs").select("id, parent_job_id").eq("id", nextId).single();
    if (error) throw error;
    if (!data) throw new Error("Curation recovery source no longer exists");
    ids.add(data.id);
    nextId = data.parent_job_id;
  }
  return [...ids];
}

export async function cancelCurationJob(
  jobId: string,
  reason = "Cancelled by admin",
): Promise<CurationJob> {
  return auditedCall(
    { provider: "curation", operation: "cancelCurationJob", kind: "service" },
    async () => {
      const supabase = createServiceClient();
      const { data, error } = await supabase.rpc("cancel_curation_job", {
        p_job_id: jobId,
        p_reason: reason,
      });

      if (error) throw error;
      if (!data?.[0]) throw new Error("Job is no longer active");
      return data[0] as CurationJob;
    },
  );
}

function encodeCurationJobCursor(
  job: Pick<CurationJob, "created_at" | "id">,
): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: job.created_at ?? new Date(0).toISOString(),
      id: job.id,
    } satisfies CurationJobCursor),
  ).toString("base64url");
}

function decodeCurationJobCursor(value: string): CurationJobCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<CurationJobCursor>;
    if (
      typeof parsed.createdAt !== "string" ||
      Number.isNaN(Date.parse(parsed.createdAt)) ||
      typeof parsed.id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(parsed.id)
    ) {
      throw new Error("Invalid cursor");
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw new Error("Invalid data jobs cursor");
  }
}

export async function getCurationJobDetail(
  jobId: string,
): Promise<CurationJobDetail> {
  const job = await getCurationJob(jobId);
  const supabase = createServiceClient();
  const [targets, parentResult, childrenResult] = await Promise.all([
    listCurationJobTargets(job.id),
    job.parent_job_id
      ? supabase
          .from("curation_jobs")
          .select("*")
          .eq("id", job.parent_job_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("curation_jobs")
      .select("*")
      .eq("parent_job_id", job.id)
      .order("created_at", { ascending: true }),
  ]);

  if (parentResult.error) throw parentResult.error;
  if (childrenResult.error) throw childrenResult.error;

  return {
    job,
    targets,
    parent: parentResult.data as CurationJob | null,
    children: (childrenResult.data ?? []) as CurationJob[],
  };
}

export async function listCurationJobTargets(
  jobId: string,
  options?: { excludeSucceeded?: boolean },
): Promise<CurationJobTarget[]> {
  const supabase = createServiceClient();
  const targets: CurationJobTarget[] = [];

  for (let page = 0; ; page += 1) {
    let query = supabase
      .from("curation_job_targets")
      .select("*")
      .eq("job_id", jobId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (options?.excludeSucceeded) {
      query = query.neq("status", "succeeded");
    }

    const { data, error } = await query.range(
      page * CURATION_TARGET_PAGE_SIZE,
      (page + 1) * CURATION_TARGET_PAGE_SIZE - 1,
    );
    if (error) throw error;

    const pageTargets = (data ?? []) as CurationJobTarget[];
    targets.push(...pageTargets);
    if (pageTargets.length < CURATION_TARGET_PAGE_SIZE) break;
  }

  return targets;
}

async function resolveTargets(
  params: CurationJobParams,
): Promise<EnqueueTarget[]> {
  if (params.submissionIds?.length) {
    return resolveSubmissionTargets(params.submissionIds);
  }

  if (params.slugs?.length) {
    throw new Error(
      "Brand-target enrichment is retired; request a refresh submission",
    );
  }

  return resolvePendingSubmissionTargets();
}

async function resolvePendingSubmissionTargets(): Promise<EnqueueTarget[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("brand_submissions")
    .select("id, brand_name, hero_image_storage_path, enriched_data, intent")
    .eq("status", "pending")
    .order("submitted_at", { ascending: true });

  if (error) throw error;

  const candidates = (data ?? []).map((submission) => {
    const enrichedData =
      submission.enriched_data &&
      typeof submission.enriched_data === "object" &&
      !Array.isArray(submission.enriched_data)
        ? enrichedDataFromDb(
            submission.enriched_data as Record<string, unknown>,
          )
        : null;
    return {
      ...submission,
      complete: hasCompleteEnrichment(
        enrichedData,
        imagePathToUrl(submission.hero_image_storage_path),
      ),
    };
  });

  if (candidates.length === 0) return [];

  const { data: targetHistory, error: targetHistoryError } = await supabase
    .from("curation_job_targets")
    .select("target_id, status, created_at, id")
    .eq("target_type", "submission")
    .in(
      "target_id",
      candidates.map((submission) => submission.id),
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (targetHistoryError) throw targetHistoryError;

  const statusesBySubmission = new Map<string, string[]>();
  for (const target of targetHistory ?? []) {
    statusesBySubmission.set(target.target_id, [
      ...(statusesBySubmission.get(target.target_id) ?? []),
      target.status,
    ]);
  }
  return candidates
    .filter((submission) =>
      isScheduledSubmissionEligible({
        intent: submission.intent,
        complete: submission.complete,
        targetStatuses: statusesBySubmission.get(submission.id) ?? [],
      }),
    )
    .map((submission) => ({
      targetType: "submission",
      targetId: submission.id,
      brandName: submission.brand_name,
      brandSlug: null,
    }));
}

async function resolveSubmissionTargets(
  submissionIds: string[],
): Promise<EnqueueTarget[]> {
  const supabase = createServiceClient();
  const pages = await Promise.all(
    chunkValues(submissionIds, SUPABASE_IN_FILTER_CHUNK_SIZE).map(
      async (ids) => {
        const { data, error } = await supabase
          .from("brand_submissions")
          .select("id, brand_name, status, intent")
          .in("id", ids);
        if (error) throw error;
        return data ?? [];
      },
    ),
  );
  const targets = pages
    .flat()
    .filter(isExplicitSubmissionEligible)
    .map((submission) => ({
      targetType: "submission" as const,
      targetId: submission.id,
      brandName: submission.brand_name,
      brandSlug: null,
    }));

  const uniqueTargets = [
    ...new Map(
      targets.map((target) => [
        `${target.targetType}:${target.targetId}`,
        target,
      ]),
    ).values(),
  ];
  if (uniqueTargets.length === 0 && submissionIds.length > 0) {
    throw new Error("Selected submissions are no longer pending");
  }
  return uniqueTargets;
}

export function isExplicitSubmissionEligible({
  status,
}: {
  status: string;
  intent: string;
}): boolean {
  return status === "pending";
}

function isScheduledSubmissionEligible(input: {
  intent: string;
  complete: boolean;
  targetStatuses: string[];
}): boolean {
  if (input.intent !== "refresh") {
    return !input.complete && input.targetStatuses.length === 0;
  }
  if (input.targetStatuses.length === 0) return true;
  if (
    input.targetStatuses.some((status) =>
      ["pending", "running", "succeeded", "skipped", "cancelled"].includes(
        status,
      ),
    )
  ) {
    return false;
  }
  return (
    input.targetStatuses.length === 1 && input.targetStatuses[0] === "failed"
  );
}

function targetToEnqueueInput(target: CurationJobTarget): EnqueueTarget {
  return {
    targetType: target.target_type,
    targetId: target.target_id,
    brandName: target.brand_name,
    brandSlug: target.brand_slug,
  };
}

const RETIRED_PHASE_NAMES = new Set(["expansion", "reputation"]);

/**
 * Preserves a job's stored params for a retry or rerun, dropping retired
 * phase names. `expansion` was renamed to `reputation` on 2026-08-03; the
 * reputation phase itself was removed on 2026-08-31. Both are filtered out
 * so a historical job rerun doesn't silently escalate to full enrichment
 * (empty phases array falls through to "run everything").
 *
 * What survives the filter is then normalized, so a rerun of a PR-1-era job
 * that named `links` re-runs `acquire` instead of scheduling a phase that no
 * longer has a runner.
 */
function parseJobParams(params: Json | null): CurationJobParams {
  if (!params || typeof params !== "object" || Array.isArray(params)) return {};
  const parsed = { ...params } as CurationJobParams;
  if (Array.isArray(parsed.phases)) {
    const kept = parsed.phases.filter(
      (phase) => !RETIRED_PHASE_NAMES.has(phase),
    );
    parsed.phases = kept.length > 0 ? normalizeRequestedPhases(kept) : [];
  }
  // budgetScale is ephemeral — granted per invocation, not inherited across
  // retries. Automatic retries (which call parseJobParams directly) must never
  // carry a prior manual-rerun's scale forward.
  delete parsed.budgetScale;
  return parsed;
}

/**
 * Returns 1.5 when any target's last acquire trace recorded budget exhaustion
 * or abort. Manual reruns grant more time to brands that hit the wall;
 * automatic retries never call this (they are cost-controlled).
 */
export function budgetScaleForRerun(
  targets: Pick<CurationJobTarget, "phase_results">[],
): number | undefined {
  return targets.some((target) =>
    lastAcquireRecordedBudgetExhausted(parsePhaseResults(target.phase_results)),
  )
    ? 1.5
    : undefined;
}

/**
 * Params for a manual rerun. A rerun must behave like the run it repeats, so
 * the source job's phase scope is preserved — dropping `phases` here silently
 * escalated an images-only job into the full pipeline (serper + LLM spend, and
 * rewritten text fields the admin never asked for).
 *
 * `stopAfter` is still dropped: the runner maps it to a SQL LIMIT, and a rerun
 * already carries an explicit, pre-filtered target list, so a stale limit would
 * silently truncate that list instead of capping a broad scan.
 */
export function rerunJobParams(
  params: Json | null,
  options?: { overwrite?: boolean; budgetScale?: number },
): CurationJobParams {
  const rerunParams = parseJobParams(params);
  delete rerunParams.stopAfter;
  rerunParams.overwrite =
    parseOverwriteParam(rerunParams.overwrite) || options?.overwrite === true;
  if (options?.budgetScale !== undefined) {
    rerunParams.budgetScale = options.budgetScale;
  }
  return rerunParams;
}

/**
 * `params` is a JSON column, so the stored value may be any JSON scalar.
 * Only a real boolean `true` (or its "true" string form) enables overwrite.
 */
export function parseOverwriteParam(value: unknown): boolean {
  return value === true || value === "true";
}

/** Compatibility facade; target execution uses readTargetPlan directly. */
export function effectiveRequestedPhases(
  params: CurationJobParams,
): EnrichPhaseName[] {
  if (params.retry && "version" in params.retry) {
    const plan = validateRecoveryPlan(params.retry);
    return ENRICH_PHASES.filter((phase) =>
      Object.values(plan.targets).some((target) =>
        target.selected.includes(phase),
      ),
    );
  }
  return readTargetPlan(params, "legacy").selected;
}

export function recoveryJobParams(
  sourceParams: Json | null,
  plan: RecoveryPlan,
  options?: { overwrite?: boolean; budgetScale?: number },
): CurationJobParams {
  const retry = validateRecoveryPlan(plan);
  const params = rerunJobParams(sourceParams, options);
  delete params.task;
  delete params.steps;
  delete params.phases;
  delete params.slugs;
  params.target = "submissions";
  params.submissionIds = Object.keys(retry.targets);
  params.retry = retry;
  return params;
}