import { createServiceClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/database.types";
import {
  enrichedDataFromDb,
  hasCompleteEnrichment,
} from "@/lib/types/enriched-data";

export const JOB_HEARTBEAT_INTERVAL_MS = 30_000;
const JOB_STALE_AFTER_MS = 10 * 60_000;
const CURATION_TARGET_PAGE_SIZE = 1_000;

type CurationJobStatus = "pending" | "running" | "completed" | "failed";
export type CurationDispatchStatus = "pending" | "dispatched" | "failed";
export type CurationJobView = "attention" | "active" | "history";
type CurationJobTrigger = "admin" | "cron" | "automatic_retry" | "manual_rerun";
export type CurationTargetStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "skipped"
  | "failed";
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
  "status" | "trigger" | "operation" | "dispatch_status"
> & {
  operation: "enrich";
  status: CurationJobStatus;
  trigger: CurationJobTrigger;
  dispatch_status: CurationDispatchStatus;
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

export type CurationJobCounts = {
  attention: number;
  active: number;
  history: number;
};

function isCurationJobNeedsAttention(job: CurationJob): boolean {
  return (
    job.status === "failed" ||
    (job.status === "completed" && job.failed_count > 0) ||
    (job.status === "pending" && job.dispatch_status === "failed")
  );
}

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

export async function markCurationJobDispatchPending(
  jobId: string,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("curation_jobs")
    .update({
      dispatch_status: "pending",
      dispatch_error: null,
    })
    .eq("id", jobId)
    .eq("status", "pending");

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
      dispatch_status: "failed",
      dispatch_error: errorMessage,
    })
    .eq("id", jobId)
    .eq("status", "pending");

  if (error) throw error;
}

export async function recoverStaleJobs(): Promise<CurationJob[]> {
  const supabase = createServiceClient();
  const staleBefore = new Date(Date.now() - JOB_STALE_AFTER_MS).toISOString();
  const { data, error } = await supabase.rpc("recover_stale_curation_jobs", {
    p_stale_before: staleBefore,
  });

  if (error) throw error;

  const recovered = (data ?? []) as CurationJob[];
  for (const job of recovered) {
    await enqueueAutomaticRetry(job);
  }

  return recovered;
}

export async function ensureAutomaticRetries(): Promise<CurationJob[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("curation_jobs")
    .select("*")
    .eq("status", "failed")
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
    source.status === "failed" ? ["pending", "running", "failed"] : ["failed"];
  const allTargets = await listCurationJobTargets(source.id);
  const submissionIds = allTargets
    .filter((target) => target.target_type === "submission")
    .map((target) => target.target_id);
  const incompleteSubmissionIds = new Set<string>();

  if (submissionIds.length > 0) {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("brand_submissions")
      .select("id, status, brand_id, hero_image_url, enriched_data")
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
  view?: CurationJobView;
}): Promise<CurationJob[]> {
  const supabase = createServiceClient();
  let query = supabase
    .from("curation_jobs")
    .select("*")
    .order("created_at", { ascending: false });

  if (options?.view === "active") {
    query = query.in("status", ["pending", "running"]);
  } else if (options?.view === "history") {
    query = query.in("status", ["completed", "failed"]);
  } else if (options?.view === "attention" || !options?.view) {
    query = query.or(
      "status.eq.failed,and(status.eq.completed,failed_count.gt.0),and(status.eq.pending,dispatch_status.eq.failed)",
    );
  }

  const { data, error } = await query.limit(options?.limit ?? 100);

  if (error) throw error;
  return (data ?? []) as CurationJob[];
}

export async function getCurationJobCounts(): Promise<CurationJobCounts> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("curation_jobs")
    .select("status, dispatch_status, failed_count");

  if (error) throw error;

  return (data ?? []).reduce<CurationJobCounts>(
    (counts, row) => {
      const job = row as CurationJob;
      if (isCurationJobNeedsAttention(job)) counts.attention += 1;
      if (job.status === "pending" || job.status === "running")
        counts.active += 1;
      if (job.status === "completed" || job.status === "failed")
        counts.history += 1;
      return counts;
    },
    { attention: 0, active: 0, history: 0 },
  );
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
    return resolveBrandTargets(params.slugs);
  }

  return resolvePendingSubmissionTargets();
}

async function resolvePendingSubmissionTargets(): Promise<EnqueueTarget[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("brand_submissions")
    .select("id, brand_name, hero_image_url, enriched_data")
    .eq("status", "pending")
    .is("brand_id", null)
    .order("created_at", { ascending: true });

  if (error) throw error;

  const candidates = (data ?? []).filter((submission) => {
    const enrichedData =
      submission.enriched_data &&
      typeof submission.enriched_data === "object" &&
      !Array.isArray(submission.enriched_data)
        ? enrichedDataFromDb(
            submission.enriched_data as Record<string, unknown>,
          )
        : null;
    return !hasCompleteEnrichment(enrichedData, submission.hero_image_url);
  });

  if (candidates.length === 0) return [];

  const { data: targetHistory, error: targetHistoryError } = await supabase
    .from("curation_job_targets")
    .select("target_id")
    .eq("target_type", "submission")
    .in(
      "target_id",
      candidates.map((submission) => submission.id),
    );

  if (targetHistoryError) throw targetHistoryError;

  const attemptedIds = new Set(
    (targetHistory ?? []).map((target) => target.target_id),
  );
  return candidates
    .filter((submission) => !attemptedIds.has(submission.id))
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
  const { data, error } = await supabase
    .from("brand_submissions")
    .select("id, brand_id, brand_name")
    .in("id", submissionIds);

  if (error) throw error;

  const linkedBrandIds = (data ?? [])
    .map((submission) => submission.brand_id)
    .filter((brandId): brandId is string => Boolean(brandId));
  const linkedBrands = new Map<
    string,
    { id: string; name: string; slug: string }
  >();

  if (linkedBrandIds.length > 0) {
    const { data: brands, error: brandsError } = await supabase
      .from("brands")
      .select("id, name, slug")
      .in("id", linkedBrandIds);

    if (brandsError) throw brandsError;
    for (const brand of brands ?? []) linkedBrands.set(brand.id, brand);
  }

  const targets = (data ?? []).map((submission) => {
    const linkedBrand = submission.brand_id
      ? linkedBrands.get(submission.brand_id)
      : null;
    return linkedBrand
      ? {
          targetType: "brand" as const,
          targetId: linkedBrand.id,
          brandName: linkedBrand.name,
          brandSlug: linkedBrand.slug,
        }
      : {
          targetType: "submission" as const,
          targetId: submission.id,
          brandName: submission.brand_name,
          brandSlug: null,
        };
  });

  return [
    ...new Map(
      targets.map((target) => [
        `${target.targetType}:${target.targetId}`,
        target,
      ]),
    ).values(),
  ];
}

async function resolveBrandTargets(slugs: string[]): Promise<EnqueueTarget[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("brands")
    .select("id, name, slug")
    .in("slug", slugs);

  if (error) throw error;

  return (data ?? []).map((brand) => ({
    targetType: "brand",
    targetId: brand.id,
    brandName: brand.name,
    brandSlug: brand.slug,
  }));
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
