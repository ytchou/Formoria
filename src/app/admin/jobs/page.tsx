import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { listCurationJobsAction } from "@/app/admin/operations/actions";
import { JobHistoryList } from "./job-history-list";

export const metadata: Metadata = { title: "Data Jobs | Admin" };
export const revalidate = 0;

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string | string[];
    cursor?: string | string[];
    direction?: string | string[];
  }>;
}) {
  const query = await searchParams;
  if (query.view) redirect("/admin/jobs");
  const cursor = first(query.cursor);
  const directionParam = first(query.direction);
  const direction = directionParam === "previous" ? "previous" : "next";
  const result = await listCurationJobsAction({ cursor, direction, limit: 50 });

  if ("error" in result) {
    return (
      <div className="space-y-4">
        <h1 className="type-section-title-large">Data Jobs</h1>
        <p className="type-error">
          {result.error}
        </p>
      </div>
    );
  }

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
        nextCursor={result.nextCursor}
        previousCursor={result.previousCursor}
        railwayLogsUrl={process.env.RAILWAY_LOGS_URL}
      />
    </div>
  );
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
