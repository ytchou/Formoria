import { getTranslations } from "next-intl/server";
import {
  approveClaimAction,
  approvePendingEditAction,
  reviewReportAction,
} from "@/app/admin/actions";
import { DashboardQueueItem } from "@/components/admin/dashboard-queue-item";
import { NewsletterSubscribersList } from "@/components/admin/newsletter-subscribers";
import { FeatureTogglesCard } from "@/components/admin/feature-toggles-card";
import { QueueSummaryCard } from "@/components/admin/queue-summary-card";
import { SystemStatusCard } from "@/components/admin/system-status-card";
import { DataCard } from "@/components/ui/card";
import { getBrands } from "@/lib/services/brands";
import {
  FEATURE_FLAGS,
  getAppSetting,
} from "@/lib/services/app-settings";
import { listClaimRequests } from "@/lib/services/claim-requests";
import {
  checkAllServices,
  type ServiceHealthResult,
} from "@/lib/services/health-checks";
import { getFlaggedContent } from "@/lib/services/moderation";
import { getSubscribers, getSubscriberStats } from "@/lib/services/newsletter";
import { getPendingEdits } from "@/lib/services/pending-edits";
import { getPendingReports } from "@/lib/services/reports";
import { getSubmissionsForReview } from "@/lib/services/submissions";
import { createServiceClient } from "@/lib/supabase/server";

type QueueItem = {
  id: string;
  label: string;
  sublabel?: string;
  date: string;
  riskLevel?: "high" | "medium" | "clean";
  action: () => Promise<unknown>;
};

type ReviewQueue = {
  key: string;
  title: string;
  count: number;
  href: string;
  emptyMessage: string;
  items: QueueItem[];
};

function formatQueueDate(value: string | null | undefined): string {
  if (!value) return "No date";
  return value.slice(0, 10);
}

async function getNewsletterDashboardData() {
  try {
    const supabase = createServiceClient();
    const [subscribers, subscriberStats] = await Promise.all([
      getSubscribers(supabase),
      getSubscriberStats(supabase),
    ]);

    return { subscribers, subscriberStats };
  } catch {
    return {
      subscribers: [],
      subscriberStats: {
        total: 0,
        confirmed: 0,
        unsubscribed: 0,
      },
    };
  }
}

export default async function AdminPage() {
  const [
    submissions,
    pendingEdits,
    claimRequests,
    reports,
    flaggedContentResult,
    brandResult,
    healthResults,
    newsletterData,
    flagValues,
    t,
  ] = await Promise.all([
    getSubmissionsForReview().catch(() => []),
    getPendingEdits("pending", { limit: 5 }).catch(() => []),
    listClaimRequests("pending", { limit: 5 }).catch(() => []),
    getPendingReports({ limit: 5 }).catch(() => []),
    getFlaggedContent({ status: "pending", limit: 5 }).catch(() => ({
      items: [],
      nextCursor: null,
    })),
    getBrands({ includeTestBrands: true, limit: 5 }).catch(() => ({
      brands: [],
      totalCount: 0,
    })),
    checkAllServices().catch((): ServiceHealthResult[] => []),
    getNewsletterDashboardData(),
    (async () => {
      const flagEntries = await Promise.all(
        FEATURE_FLAGS.map(async (flag) => [
          flag.key,
          await getAppSetting(flag.key, flag.defaultValue),
        ] as const),
      );
      return Object.fromEntries(flagEntries) as Record<string, boolean>;
    })(),
    getTranslations("admin.dashboard"),
  ]);

  const flaggedContent = flaggedContentResult.items;
  const { subscribers, subscriberStats } = newsletterData;

  const pendingSubmissions = submissions.filter(
    (submission) => submission.status === "pending",
  );
  const readySubmissions = pendingSubmissions.filter(
    (submission) => submission.reviewStage === "ready",
  );
  const dataWorkSubmissions = pendingSubmissions.filter(
    (submission) => submission.reviewStage !== "ready",
  );

  const queues: ReviewQueue[] = [
    {
      key: "edits",
      title: t("queues.edits.title"),
      count: pendingEdits.length,
      href: "/admin/edits",
      emptyMessage: t("queues.edits.empty"),
      items: pendingEdits.map((edit) => ({
        id: edit.id,
        label: edit.brand.name || edit.brandId,
        sublabel: edit.brand.contactEmail ?? edit.submittedBy,
        date: formatQueueDate(edit.createdAt),
        action: approvePendingEditAction.bind(null, edit.id),
      })),
    },
    {
      key: "claims",
      title: t("queues.claims.title"),
      count: claimRequests.length,
      href: "/admin/claims",
      emptyMessage: t("queues.claims.empty"),
      items: claimRequests.map((claim) => ({
        id: claim.id,
        label: claim.brandName ?? claim.brandId,
        sublabel: claim.requesterEmail ?? claim.proofUrl ?? claim.userId,
        date: formatQueueDate(claim.createdAt),
        action: approveClaimAction.bind(null, claim.id),
      })),
    },
    {
      key: "reports",
      title: t("queues.reports.title"),
      count: reports.length,
      href: "/admin/reports",
      emptyMessage: t("queues.reports.empty"),
      items: reports.map((report) => ({
        id: report.id,
        label: report.brandName ?? report.brandId,
        sublabel: report.notes ?? report.reason,
        date: formatQueueDate(report.createdAt),
        riskLevel: "medium" as const,
        action: reviewReportAction.bind(null, report.id, "reviewed"),
      })),
    },
  ].sort((left, right) => right.count - left.count);

  const overviewStats = [
    {
      label: t("stats.totalBrandsLabel"),
      value: brandResult.totalCount,
      description: t("stats.totalBrandsDesc"),
    },
    {
      label: t("stats.flaggedContentLabel"),
      value: flaggedContent.length,
      description: t("stats.flaggedContentDesc"),
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <p className="text-warm-caption">
          {t("description")}
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SystemStatusCard initialResults={healthResults} />
        <FeatureTogglesCard initialValues={flagValues} />
      </div>

      <section aria-labelledby="review-queues">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 id="review-queues" className="type-section-title-large">
              {t("reviewQueues")}
            </h2>
            <p className="mt-1 type-card-description">{t("reviewQueuesSub")}</p>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          {queues.map((queue) => (
            <div key={queue.key} data-testid="queue-summary-card">
              <QueueSummaryCard
                title={queue.title}
                count={queue.count}
                href={queue.href}
                emptyMessage={queue.emptyMessage}
              >
                {queue.items.map((item) => (
                  <DashboardQueueItem
                    key={item.id}
                    label={item.label}
                    sublabel={item.sublabel}
                    date={item.date}
                    riskLevel={item.riskLevel}
                    onApprove={item.action}
                  />
                ))}
              </QueueSummaryCard>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="submission-stages">
        <div className="mb-4">
          <h2 id="submission-stages" className="type-section-title-large">
            {t("newSubmissions")}
          </h2>
          <p className="mt-1 type-card-description">
            {t("newSubmissionsSub")}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <QueueSummaryCard
            title={t("stages.needsData")}
            count={dataWorkSubmissions.length}
            href="/admin/submissions?stage=needs_data"
            emptyMessage={t("stages.emptyNeedsData")}
          />
          <QueueSummaryCard
            title={t("stages.readyToReview")}
            count={readySubmissions.length}
            href="/admin/submissions?stage=ready"
            emptyMessage={t("stages.emptyReadyToReview")}
          />
        </div>
      </section>

      <section aria-labelledby="overview">
        <div className="mb-4">
          <h2 id="overview" className="type-section-title-large">
            {t("overview")}
          </h2>
          <p className="mt-1 type-card-description">
            {t("overviewSub")}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {overviewStats.map((stat) => (
            <DataCard
              key={stat.label}
              label={stat.label}
              value={stat.value}
              description={stat.description}
              padding="lg"
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="newsletter-subscribers">
        <div className="mb-4">
          <h2 id="newsletter-subscribers" className="type-section-title-large">
            {t("newsletterSection")}
          </h2>
          <p className="mt-1 type-card-description">
            {t("newsletterSectionSub")}
          </p>
        </div>

        <NewsletterSubscribersList
          subscribers={subscribers}
          stats={subscriberStats}
        />
      </section>
    </div>
  );
}
