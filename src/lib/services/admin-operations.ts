import { cache } from "react";
import { createServiceClient } from "@/lib/supabase/service";
import { listCurationJobs, type CurationJob } from "@/lib/services/curation-jobs";
import { getSubmissionsForReview } from "@/lib/services/submissions";

export type AdminOperationsMetrics = {
  needsData: number | null;
  ready: number | null;
  moderation: number | null;
  evidence: number | null;
  claims: number | null;
  reports: number | null;
  activeJobs: number | null;
  brands: number | null;
  subscribers: number | null;
};

export type AdminOperationsSnapshot = {
  metrics: AdminOperationsMetrics;
  recentJobs: CurationJob[];
};

export const getAdminOperationsSnapshot = cache(
  async (): Promise<AdminOperationsSnapshot> => {
    const supabase = createServiceClient();
    const [submissions, moderation, evidence, claims, reports, activeJobs, brands, subscribers, jobs] =
      await Promise.allSettled([
        getSubmissionsForReview({ status: "pending" }),
        exactCount(supabase.from("moderation_flags").select("id", { count: "exact", head: true }).eq("status", "pending")),
        exactCount(supabase.from("origin_evidence").select("id", { count: "exact", head: true }).eq("status", "pending")),
        exactCount(supabase.from("claim_requests").select("id", { count: "exact", head: true }).eq("status", "pending")),
        exactCount(supabase.from("brand_reports").select("id", { count: "exact", head: true }).eq("status", "pending")),
        exactCount(supabase.from("curation_jobs").select("id", { count: "exact", head: true }).in("status", ["pending", "running"])),
        exactCount(supabase.from("brands").select("id", { count: "exact", head: true })),
        exactCount(
          supabase
            .from("newsletter_subscribers")
            .select("id", { count: "exact", head: true })
            .not("confirmed_at", "is", null)
            .is("unsubscribed_at", null),
        ),
        listCurationJobs({ limit: 5 }),
      ]);

    logRejected("submissions", submissions);
    logRejected("moderation", moderation);
    logRejected("evidence", evidence);
    logRejected("claims", claims);
    logRejected("reports", reports);
    logRejected("activeJobs", activeJobs);
    logRejected("brands", brands);
    logRejected("subscribers", subscribers);
    logRejected("recentJobs", jobs);

    const pendingSubmissions = submissions.status === "fulfilled" ? submissions.value : null;
    return {
      metrics: {
        needsData: pendingSubmissions
          ? pendingSubmissions.filter((submission) => submission.reviewStage === "needs_data").length
          : null,
        ready: pendingSubmissions
          ? pendingSubmissions.filter((submission) => submission.reviewStage === "ready").length
          : null,
        moderation: settledValue(moderation),
        evidence: settledValue(evidence),
        claims: settledValue(claims),
        reports: settledValue(reports),
        activeJobs: settledValue(activeJobs),
        brands: settledValue(brands),
        subscribers: settledValue(subscribers),
      },
      recentJobs: jobs.status === "fulfilled" ? jobs.value.jobs : [],
    };
  },
);

export const getAdminNavCounts = cache(async () => {
  const supabase = createServiceClient();
  const [submissions, moderation, evidence, reports, corrections, stockists] = await Promise.allSettled([
    exactCount(supabase.from("brand_submissions").select("id", { count: "exact", head: true }).eq("status", "pending")),
    exactCount(supabase.from("moderation_flags").select("id", { count: "exact", head: true }).eq("status", "pending")),
    exactCount(supabase.from("origin_evidence").select("id", { count: "exact", head: true }).eq("status", "pending")),
    exactCount(supabase.from("brand_reports").select("id", { count: "exact", head: true }).eq("status", "pending")),
    exactCount(supabase.from("brand_field_corrections").select("id", { count: "exact", head: true }).eq("status", "pending")),
    // A pending community stockist is invisible to the public until an admin
    // decides on it, so an un-advertised queue is a queue nobody empties.
    exactCount(
      supabase
        .from("brand_channels")
        .select("id", { count: "exact", head: true })
        .eq("source", "community")
        .eq("owner_status", "none")
        .is("removed_at", null),
    ),
  ]);
  logRejected("nav:submissions", submissions);
  logRejected("nav:moderation", moderation);
  logRejected("nav:evidence", evidence);
  logRejected("nav:reports", reports);
  logRejected("nav:corrections", corrections);
  logRejected("nav:stockists", stockists);
  return {
    submissions: settledValue(submissions),
    moderation: settledValue(moderation),
    evidence: settledValue(evidence),
    reports: settledValue(reports),
    corrections: settledValue(corrections),
    stockists: settledValue(stockists),
  };
});

async function exactCount(
  request: PromiseLike<{
    count: number | null;
    error: { message: string } | null;
  }>,
): Promise<number> {
  const { count, error } = await request;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

function settledValue(result: PromiseSettledResult<number>): number | null {
  return result.status === "fulfilled" ? result.value : null;
}

function logRejected(label: string, result: PromiseSettledResult<unknown>): void {
  if (result.status === "rejected") {
    console.error(`[admin:operations:${label}]`, result.reason);
  }
}
