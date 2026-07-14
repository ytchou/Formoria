import type { Metadata } from "next";
import {
  getCurationJobCountsAction,
  listCurationJobsAction,
} from "@/app/admin/operations/actions";
import type {
  CurationJobCounts,
  CurationJobView,
} from "@/lib/services/curation-jobs";
import { JobHistoryList } from "./job-history-list";

export const metadata: Metadata = { title: "Data Jobs | Admin" };
export const revalidate = 0;

const validViews = new Set<CurationJobView>(["attention", "active", "history"]);

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const query = await searchParams;
  const viewParam = Array.isArray(query.view) ? query.view[0] : query.view;
  const view: CurationJobView = validViews.has(viewParam as CurationJobView)
    ? (viewParam as CurationJobView)
    : "attention";
  const [result, countsResult] = await Promise.all([
    listCurationJobsAction({ view }),
    getCurationJobCountsAction(),
  ]);

  if ("error" in result || "error" in countsResult) {
    return (
      <div className="space-y-4">
        <h1 className="type-section-title-large">Data Jobs</h1>
        <p className="type-error">
          {"error" in result ? result.error : countsResult.error}
        </p>
      </div>
    );
  }

  const counts: CurationJobCounts = countsResult.counts;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="type-section-title-large">Data Jobs</h1>
        <p className="mt-1 type-card-description">
          Track data enrichment job dispatch, execution progress, and results.
        </p>
      </div>
      <JobHistoryList
        initialJobs={result.jobs}
        counts={counts}
        view={view}
        railwayLogsUrl={process.env.RAILWAY_LOGS_URL}
      />
    </div>
  );
}
