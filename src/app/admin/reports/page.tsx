import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";

import { reviewReportAction } from "@/app/admin/actions";
import { ReportsTable } from "@/components/admin/reports-table";
import { Skeleton } from "@/components/ui/skeleton";
import { getPendingReports } from "@/lib/services/reports";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.reports");

  return { title: t("title") };
}

async function ReportsData() {
  let reports: Awaited<ReturnType<typeof getPendingReports>> = [];
  try {
    reports = await getPendingReports();
  } catch (err) {
    console.error("[admin:reports]", err);
  }

  return <ReportsTable reports={reports} reviewAction={reviewReportAction} />;
}

function ReportsFallback() {
  return (
    <div aria-hidden className="space-y-3">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

export default async function AdminReportsPage() {
  const t = await getTranslations("admin.reports");

  return (
    <div>
      <div className="mb-6">
        <h1 className="type-tool-heading">{t("title")}</h1>
        <p className="mt-1 type-body-sm">{t("description")}</p>
      </div>
      <Suspense fallback={<ReportsFallback />}>
        <ReportsData />
      </Suspense>
    </div>
  );
}
