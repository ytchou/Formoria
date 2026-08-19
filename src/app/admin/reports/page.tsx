import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { reviewReportAction, revokeOwnershipAction } from "@/app/admin/actions";
import { ReportsTable } from "@/components/admin/reports-table";
import { getPendingReports } from "@/lib/services/reports";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.reports");

  return { title: t("title") };
}

export default async function AdminReportsPage() {
  const t = await getTranslations("admin.reports");
  let reports: Awaited<ReturnType<typeof getPendingReports>> = [];
  try {
    reports = await getPendingReports();
  } catch (err) {
    console.error("[admin:reports]", err);
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="type-section">Brand Reports</h1>
        <p className="mt-1 type-body-sm">{t("description")}</p>
      </div>
      <ReportsTable
        reports={reports}
        reviewAction={reviewReportAction}
        revokeAction={revokeOwnershipAction}
      />
    </div>
  );
}
