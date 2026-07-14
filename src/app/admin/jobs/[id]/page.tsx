import type { Metadata } from "next";
import { getCurationJobDetailAction } from "@/app/admin/operations/actions";
import type { CurationTargetStatus } from "@/lib/services/curation-jobs";
import { JobDetailView } from "./job-detail-view";

export const metadata: Metadata = { title: "資料工作明細 | 管理後台" };
export const revalidate = 0;

const validStatuses = new Set<string>([
  "pending",
  "running",
  "succeeded",
  "skipped",
  "failed",
]);

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
        <h1 className="type-section-title-large">資料工作明細</h1>
        <p className="type-error">{result.error}</p>
      </div>
    );
  }

  return (
    <JobDetailView
      detail={result.detail}
      selectedStatus={selectedStatus}
      railwayLogsUrl={process.env.RAILWAY_LOGS_URL}
    />
  );
}
