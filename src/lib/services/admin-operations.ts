import { cache } from "react";
import { createServiceClient } from "@/lib/supabase/server";
import { listCurationJobs, type CurationJob } from "@/lib/services/curation-jobs";
import { getSubmissionsForReview } from "@/lib/services/submissions";

export type AdminOperationsMetrics = {
  needsData: number | null;
  ready: number | null;
  moderation: number | null;
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
    const [submissions, moderation, claims, reports, activeJobs, brands, subscribers, jobs] =
      await Promise.allSettled([
        getSubmissionsForReview({ status: "pending" }),
        exactCount(supabase.from("moderation_flags").select("id", { count: "exact", head: true }).eq("status", "pending")),
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
  const [submissions, moderation, reports] = await Promise.allSettled([
    exactCount(supabase.from("brand_submissions").select("id", { count: "exact", head: true }).eq("status", "pending")),
    exactCount(supabase.from("moderation_flags").select("id", { count: "exact", head: true }).eq("status", "pending")),
    exactCount(supabase.from("brand_reports").select("id", { count: "exact", head: true }).eq("status", "pending")),
  ]);
  logRejected("nav:submissions", submissions);
  logRejected("nav:moderation", moderation);
  logRejected("nav:reports", reports);
  return {
    submissions: settledValue(submissions),
    moderation: settledValue(moderation),
    reports: settledValue(reports),
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
