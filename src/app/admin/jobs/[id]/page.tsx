import type { Metadata } from "next";
import { getCurationJobDetailAction } from "@/app/admin/operations/actions";
import type { CurationTargetStatus } from "@/lib/services/curation-jobs";
import { getRunLogSnapshotUrl } from "@/lib/services/runlog-storage";
import { JobDetailView } from "./job-detail-view";

export const metadata: Metadata = { title: "Job Detail | Admin" };
export const revalidate = 0;

const validStatuses = new Set<string>([
  "pending",
  "running",
  "succeeded",
  "skipped",
  "failed",
]);
const terminalJobStatuses = new Set(["completed", "failed", "cancelled"]);

export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const statusParam = Array.isArray(query.status)
    ? query.status[0]
    : query.status;
  const selectedStatus: "all" | CurationTargetStatus =
    statusParam && validStatuses.has(statusParam)
      ? (statusParam as CurationTargetStatus)
      : "all";
  const result = await getCurationJobDetailAction(id);

  if ("error" in result) {
    return (
      <div className="space-y-4">
        <h1 className="type-section-title-large">Job Detail</h1>
        <p className="type-error">{result.error}</p>
      </div>
    );
  }

  let snapshotUrl: string | null = null;
  if (terminalJobStatuses.has(result.detail.job.status)) {
    try {
      snapshotUrl = await getRunLogSnapshotUrl(id);
    } catch {
      snapshotUrl = null;
    }
  }

  return (
    <JobDetailView
      detail={result.detail}
      selectedStatus={selectedStatus}
      railwayLogsUrl={process.env.RAILWAY_LOGS_URL}
      snapshotUrl={snapshotUrl}
    />
  );
}
