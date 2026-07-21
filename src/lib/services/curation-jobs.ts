import { createServiceClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/database.types";
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
  phases?: string[];
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
  attempt?: 1 | 2;
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
  const targets = await resolveTargets(input.params);

  return enqueueCurationJob({
    operation: "enrich",
    params: input.params,
    dryRun: input.dryRun,
    startedBy: input.startedBy,
    trigger: "admin",
    targets,
  });
}

export async function enqueueScheduledSubmissionJob(
  scheduledFor: Date,
): Promise<CurationJob> {
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
}

export async function claimNextCurationJob(
  workerToken: string,
): Promise<CurationJob | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("claim_next_curation_job", {
    p_worker_token: workerToken,
  });

  if (error) throw error;

  return data[0] ? (data[0] as CurationJob) : null;
}

export async function claimCurationJob(
  jobId: string,
  workerToken: string,
): Promise<CurationJob | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("claim_curation_job", {
    p_job_id: jobId,
    p_worker_token: workerToken,
  });

  if (error) throw error;

  return data[0] ? (data[0] as CurationJob) : null;
}

export async function markCurationJobDispatched(jobId: string): Promise<void> {
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
}

export async function recordCurationDispatchFailure(
  jobId: string,
  errorMessage: string,
): Promise<void> {
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
}

export async function recoverStaleJobs(): Promise<CurationJob[]> {
  const supabase = createServiceClient();
  const staleBefore = new Date(Date.now() - JOB_STALE_AFTER_MS).toISOString();
  const { data, error } = await supabase.rpc("recover_stale_curation_jobs", {
    p_stale_before: staleBefore,
  });

  if (error) throw error;

  return (data ?? []) as CurationJob[];
}

export async function ensureAutomaticRetries(): Promise<CurationJob[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("curation_jobs")
    .select("*")
    .eq("status", "failed")
    .in("dispatch_status", ["dispatched", "failed"])
    .eq("attempt", 1)
    .order("completed_at", { ascending: true });

  if (error) throw error;

  const retries: CurationJob[] = [];
  for (const job of (data ?? []) as CurationJob[]) {
    const retry = await enqueueAutomaticRetry(job);
    if (retry) retries.push(retry);
  }

  return retries;
}

export async function enqueueAutomaticRetry(
  job: CurationJob,
): Promise<CurationJob | null> {
  if (job.trigger === "automatic_retry" || job.attempt !== 1) {
    return null;
  }

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
    attempt: 2,
    scheduledFor: job.scheduled_for,
    runAfter: new Date().toISOString(),
  });
}

export async function enqueueManualRerun(
  sourceJobId: string,
  startedBy: string,
): Promise<CurationJob> {
  const source = await getCurationJob(sourceJobId);
  const retryStatuses: CurationTargetStatus[] =
    source.status === "failed" || source.status === "cancelled"
      ? ["pending", "running", "failed", "cancelled"]
      : ["failed"];
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

  const targets = allTargets.filter(
    (target) =>
      retryStatuses.includes(target.status) ||
      (target.target_type === "submission" &&
        incompleteSubmissionIds.has(target.target_id)),
  );

  if (targets.length === 0) {
    throw new Error("This job has no failed or unfinished targets to rerun");
  }

  const params = parseJobParams(source.params);
  delete params.phases;
  delete params.stopAfter;

  return enqueueCurationJob({
    operation: "enrich",
    params,
    dryRun: source.dry_run,
    startedBy,
    trigger: "manual_rerun",
    targets: targets.map(targetToEnqueueInput),
    parentJobId: source.id,
  });
}

export async function heartbeatCurationJob(
  jobId: string,
  workerToken: string,
  current?: { targetId?: string | null; phase?: string | null },
): Promise<boolean> {
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
}

export async function updateCurationJobTarget(
  jobId: string,
  targetId: string,
  patch: Database["public"]["Tables"]["curation_job_targets"]["Update"],
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("curation_job_targets")
    .update(patch)
    .eq("job_id", jobId)
    .eq("target_id", targetId);

  if (error) throw error;
}

export async function finalizeCurationJob(
  jobId: string,
  workerToken: string,
  patch: Database["public"]["Tables"]["curation_jobs"]["Update"],
): Promise<boolean> {
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
}

export async function listCurationJobs(options?: {
  limit?: number;
  cursor?: string;
  direction?: "next" | "previous";
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
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("cancel_curation_job", {
    p_job_id: jobId,
    p_reason: reason,
  });

  if (error) throw error;
  if (!data?.[0]) throw new Error("Job is no longer active");
  return data[0] as CurationJob;
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
    .filter(
      (submission) =>
        submission.status === "pending" && submission.intent !== "refresh",
    )
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
    throw new Error("Refresh submissions wait for scheduled enrichment");
  }
  return uniqueTargets;
}

export function isScheduledSubmissionEligible(input: {
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

function parseJobParams(params: Json | null): CurationJobParams {
  return params && typeof params === "object" && !Array.isArray(params)
    ? ({ ...params } as CurationJobParams)
    : {};
}
