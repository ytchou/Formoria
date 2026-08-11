import { createServiceClient } from "@/lib/supabase/service";
import { auditedCall } from "@/lib/audit";
import type { Database, Json } from "@/lib/supabase/database.types";
import {
  CURATION_STEPS,
  ENRICH_LLM_PHASES,
  ENRICH_PHASES,
  phasesForSteps,
  type CurationStep,
  type EnrichPhaseName,
} from "@/lib/constants/enrich-phases";
import {
  computeBackoffDelay,
  JOB_REQUEUE,
  RETRY_ATTEMPTS,
} from "@/lib/retry";
import { parsePhaseResults } from "@/lib/services/phase-results";
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
   * New jobs from the admin UI send `steps` instead; the runner expands those
   * into phases so persisted phase-level reporting is unchanged.
   */
  phases?: string[];
  steps?: string[];
  overwrite?: boolean;
  status?: string;
  target?: "submissions" | "brands";
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

export async function enqueueManualRerun(
  sourceJobId: string,
  startedBy: string,
  options?: { overwrite?: boolean },
): Promise<CurationJob> {
  return auditedCall(
    { provider: "curation", operation: "enqueueManualRerun", kind: "service" },
    async () => {
      const source = await getCurationJob(sourceJobId);
      const allTargets = await listCurationJobTargets(source.id);
      if (allTargets.some((target) => target.target_type === "brand")) {
        throw new Error(
          "Brand-target enrichment jobs are retired; request a refresh submission",
        );
      }
      const submissionIds = allTargets
        .filter((target) => target.target_type === "submission")
        .map((target) => target.target_id);
      const incompleteSubmissionIds = new Set<string>();

      if (submissionIds.length > 0) {
        const supabase = createServiceClient();
        const { data, error } = await supabase
          .from("brand_submissions")
          .select("id, status, brand_id, hero_image_url, enriched_data, owner_data")
          .in("id", submissionIds);

        if (error) throw error;
        for (const submission of data ?? []) {
          const enrichedData =
            submission.enriched_data &&
            typeof submission.enriched_data === "object" &&
            !Array.isArray(submission.enriched_data)
              ? enrichedDataFromDb(
                  submission.enriched_data as Record<string, unknown>,
                )
              : null;
          if (
            submission.status === "pending" &&
            submission.brand_id === null &&
            !hasCompleteEnrichment(enrichedData, submission.hero_image_url)
          ) {
            incompleteSubmissionIds.add(submission.id);
          }
        }
      }

      const targets = allTargets.filter((target) =>
        isManualRerunTargetEligible({
          sourceStatus: source.status,
          targetStatus: target.status,
          isIncompleteSubmission:
            target.target_type === "submission" &&
            incompleteSubmissionIds.has(target.target_id),
        }),
      );

      if (targets.length === 0) {
        throw new Error(
          "This job has no failed, skipped, or unfinished targets to rerun",
        );
      }

      const params = rerunJobParams(source.params, options);

      return enqueueCurationJob({
        operation: "enrich",
        params,
        dryRun: source.dry_run,
        startedBy,
        trigger: "manual_rerun",
        targets: targets.map(targetToEnqueueInput),
        parentJobId: source.id,
      });
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
    .select("id, brand_name, hero_image_url, enriched_data, intent")
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
      complete: hasCompleteEnrichment(enrichedData, submission.hero_image_url),
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

/**
 * Preserves a job's stored params for a retry or rerun, normalising the one
 * phase name that was renamed in place: `expansion` became `reputation` on
 * 2026-08-03. Re-enqueuing the legacy value would have it dropped by
 * `parseEnrichPhases` at run time, quietly narrowing the retry's scope.
 */
function parseJobParams(params: Json | null): CurationJobParams {
  if (!params || typeof params !== "object" || Array.isArray(params)) return {};
  const parsed = { ...params } as CurationJobParams;
  if (Array.isArray(parsed.phases)) {
    parsed.phases = parsed.phases.map((phase) =>
      phase === "expansion" ? "reputation" : phase,
    );
  }
  return parsed;
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
function rerunJobParams(
  params: Json | null,
  options?: { overwrite?: boolean },
): CurationJobParams {
  const rerunParams = parseJobParams(params);
  delete rerunParams.stopAfter;
  rerunParams.overwrite =
    parseOverwriteParam(rerunParams.overwrite) || options?.overwrite === true;
  return rerunParams;
}

/**
 * `params` is a JSON column, so the stored value may be any JSON scalar.
 * Only a real boolean `true` (or its "true" string form) enables overwrite.
 */
export function parseOverwriteParam(value: unknown): boolean {
  return value === true || value === "true";
}

type CurationResumeGroup = "failed" | "cancelled";

export type CurationResumePlan = {
  group: CurationResumeGroup;
  targets: CurationJobTarget[];
  params: CurationJobParams;
};

/**
 * The enqueued job plus the grouping that produced it, so the admin action can
 * report "N failed and M cancelled" without re-reading the source targets.
 * Structurally still a `CurationJob`, so every existing consumer is unaffected.
 */
export type CurationResumeJob = CurationJob & {
  resumeGroup: CurationResumeGroup;
  resumeTargetCount: number;
};

/**
 * `reputation` was called `expansion` until 2026-08-03 and historical
 * `phase_results` rows still carry the old string. Normalising here is what
 * lets a pre-rename job's recorded phases be matched against the current
 * `ENRICH_PHASES` scope; without it every such phase would look "never
 * recorded" and the resume would re-run work that already succeeded.
 *
 * `job-runner` exports the same mapping, but importing it here would close an
 * import cycle (job-runner already imports this module), so the one-line
 * mapping is repeated rather than shared.
 */
function normalizeLegacyPhaseName(phase: string): string {
  return phase === "expansion" ? "reputation" : phase;
}

/**
 * The phase scope a stored job actually ran.
 *
 * WHY this is not just `params.phases`: `runEnrich` resolves its scope as
 * `config.steps?.length ? phasesForSteps(config.steps) : config.phases`
 * (curation-operations.ts) — `steps` *beats* `phases`. A job enqueued from the
 * admin UI carries `steps` only, so reading `phases` alone would report an
 * empty scope for every modern job and the resume would fall back to the full
 * pipeline. Absent both, the runner defaults to all of `ENRICH_PHASES`.
 */
function effectiveRequestedPhases(
  params: CurationJobParams,
): EnrichPhaseName[] {
  const knownSteps = Object.keys(CURATION_STEPS) as CurationStep[];
  const steps = Array.isArray(params.steps)
    ? params.steps.filter((step): step is CurationStep =>
        (knownSteps as readonly string[]).includes(step),
      )
    : [];
  if (steps.length > 0) return phasesForSteps(steps);

  const phases = Array.isArray(params.phases)
    ? new Set(params.phases.map(normalizeLegacyPhaseName))
    : null;
  if (!phases || phases.size === 0) return [...ENRICH_PHASES];

  const known = ENRICH_PHASES.filter((phase) => phases.has(phase));
  return known.length > 0 ? known : [...ENRICH_PHASES];
}

/**
 * The phases a set of failed targets still owes, unioned across the group.
 *
 * Two sources, because a crash records nothing after the phase it died in:
 * 1. `phase_results` entries explicitly marked `failed`.
 * 2. Phases in the requested scope with no `phase_results` entry at all — the
 *    target never reached them.
 *
 * The union is intersected with the source scope so an images-only job can
 * never silently expand into the text phases (which would rewrite copy the
 * admin never asked to touch, and pay for it).
 *
 * The empty-union fallback exists for the 2026-08-02 records specifically:
 * before the truthful-phase-status fix, LLM phases wrote `succeeded` even when
 * every OpenAI call returned `insufficient_quota`, so those targets have a full
 * set of green entries and nothing to key off. Re-running the LLM phases in
 * scope is the correct recovery for them, and it re-pays nothing to Serper
 * because SERP results replay from cache whenever `discover` is absent.
 */
function unfinishedPhasesForTargets(
  targets: CurationJobTarget[],
  scope: readonly EnrichPhaseName[],
): EnrichPhaseName[] {
  const inScope = new Set<string>(scope);
  const owed = new Set<string>();

  for (const target of targets) {
    const results = parsePhaseResults(target.phase_results);
    const recorded = new Set(
      results.map((result) => normalizeLegacyPhaseName(result.phase)),
    );
    for (const result of results) {
      if (result.status === "failed") {
        owed.add(normalizeLegacyPhaseName(result.phase));
      }
    }
    for (const phase of scope) {
      if (!recorded.has(phase)) owed.add(phase);
    }
  }

  const union = ENRICH_PHASES.filter(
    (phase) => owed.has(phase) && inScope.has(phase),
  );
  if (union.length > 0) return union;

  const llmFallback = ENRICH_LLM_PHASES.filter((phase) => inScope.has(phase));
  // A SERP-only scope has no LLM phase to fall back to; re-running the scope
  // itself is then the only thing "resume" can mean.
  return llmFallback.length > 0 ? [...llmFallback] : [...scope];
}

/**
 * Builds one job's params from the source job's.
 *
 * `steps` MUST be deleted: it wins over `phases` in `runEnrich`, so carrying it
 * through would make the narrowed phase list computed above completely inert
 * and resume would re-run the full step group — including `discover`, which
 * re-pays serper.dev per brand.
 *
 * `stopAfter` is dropped for the same reason `rerunJobParams` drops it: the
 * runner turns it into a SQL LIMIT, and a resume already carries an explicit,
 * pre-filtered target list that a stale limit would silently truncate.
 */
function resumeJobParams(
  sourceParams: CurationJobParams,
  targets: CurationJobTarget[],
  phases: readonly EnrichPhaseName[],
): CurationJobParams {
  const params: CurationJobParams = { ...sourceParams };
  delete params.steps;
  delete params.stopAfter;
  delete params.slugs;

  params.target = "submissions";
  params.submissionIds = targets.map((target) => target.target_id);
  params.phases = [...phases];
  params.overwrite = parseOverwriteParam(sourceParams.overwrite);

  return params;
}

/**
 * Splits the eligible targets into the (at most) two jobs a resume enqueues.
 *
 * Two jobs and not one because `params.phases` is job-wide. Failed targets get
 * only the phases they still owe; cancelled targets never started, so they need
 * the source's full scope. Merging the groups would force the union onto both,
 * which for the 2026-08-02 victims means dragging `discover` back in and
 * re-paying serper.dev for brands whose SERP snippets are already cached.
 *
 * Pure and exported so the phase arithmetic — the part that decides LLM spend —
 * is testable without a database.
 */
export function planCurationResume(
  sourceParams: Json | null,
  eligibleTargets: CurationJobTarget[],
): CurationResumePlan[] {
  if (eligibleTargets.length === 0) {
    throw new Error(
      "This job has no failed or cancelled targets left to resume",
    );
  }

  const parsed = parseJobParams(sourceParams);
  const scope = effectiveRequestedPhases(parsed);
  const failedTargets = eligibleTargets.filter(
    (target) => target.status === "failed",
  );
  const cancelledTargets = eligibleTargets.filter(
    (target) => target.status === "cancelled",
  );

  const plans: CurationResumePlan[] = [];
  if (failedTargets.length > 0) {
    plans.push({
      group: "failed",
      targets: failedTargets,
      params: resumeJobParams(
        parsed,
        failedTargets,
        unfinishedPhasesForTargets(failedTargets, scope),
      ),
    });
  }
  if (cancelledTargets.length > 0) {
    plans.push({
      group: "cancelled",
      targets: cancelledTargets,
      params: resumeJobParams(parsed, cancelledTargets, scope),
    });
  }

  return plans;
}

/**
 * Re-enqueues only the unfinished work of a failed job.
 *
 * A deliberate sibling of `enqueueManualRerun` rather than an option on it:
 * `rerunJobParams` documents a "behave like the run it repeats" contract and
 * preserves the source scope, while resume must do the opposite — rewrite
 * `submissionIds`, override `phases`, and delete `steps`. Folding the two would
 * have made that contract conditional, and the failure mode of getting it wrong
 * is spending money.
 *
 * Everything is recomputed server-side from `listCurationJobTargets`. The phase
 * list controls LLM spend, so it is never accepted from the client.
 */
export async function enqueueCurationResume(
  sourceJobId: string,
  startedBy: string,
): Promise<CurationResumeJob[]> {
  return auditedCall(
    { provider: "curation", operation: "enqueueCurationResume", kind: "service" },
    async () => {
      const source = await getCurationJob(sourceJobId);
      const allTargets = await listCurationJobTargets(source.id);
      if (allTargets.some((target) => target.target_type === "brand")) {
        throw new Error(
          "Brand-target enrichment jobs are retired; request a refresh submission",
        );
      }

      const unfinished = allTargets.filter(
        (target) =>
          target.target_type === "submission" &&
          (target.status === "failed" || target.status === "cancelled"),
      );

      // A target whose submission was approved (or deleted) since the outage has
      // nothing left to enrich — resuming it would fail preflight in the worker.
      const pendingSubmissionIds = await filterPendingSubmissionIds(
        unfinished.map((target) => target.target_id),
      );
      const eligible = unfinished.filter((target) =>
        pendingSubmissionIds.has(target.target_id),
      );

      const plans = planCurationResume(source.params, eligible);
      const jobs: CurationResumeJob[] = [];
      for (const plan of plans) {
        const job = await enqueueCurationJob({
          operation: "enrich",
          params: plan.params,
          dryRun: source.dry_run,
          startedBy,
          trigger: "manual_rerun",
          targets: plan.targets.map(targetToEnqueueInput),
          parentJobId: source.id,
        });
        jobs.push({
          ...job,
          resumeGroup: plan.group,
          resumeTargetCount: plan.targets.length,
        });
      }

      return jobs;
    },
  );
}

async function filterPendingSubmissionIds(
  submissionIds: string[],
): Promise<Set<string>> {
  if (submissionIds.length === 0) return new Set();

  const supabase = createServiceClient();
  const pages = await Promise.all(
    chunkValues(submissionIds, SUPABASE_IN_FILTER_CHUNK_SIZE).map(
      async (ids) => {
        const { data, error } = await supabase
          .from("brand_submissions")
          .select("id, status")
          .in("id", ids);
        if (error) throw error;
        return data ?? [];
      },
    ),
  );

  return new Set(
    pages
      .flat()
      .filter((submission) => submission.status === "pending")
      .map((submission) => submission.id),
  );
}
