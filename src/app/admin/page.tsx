import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { AdminQuickActions } from "@/components/admin/admin-quick-actions";
import { JobStatusBadge, formatJobDate } from "@/app/admin/jobs/job-display";
import {
  getAdminOperationsSnapshot,
  type AdminOperationsMetrics,
} from "@/lib/services/admin-operations";
import { isOwnerFeaturesEnabled } from "@/lib/services/app-settings";
import { cn } from "@/lib/utils";
import { routes } from "@/lib/routes";

/**
 * One tile of the operations grid. Both the numeric queue metrics and the
 * owner-features flag tile render through this, so their markup, focus ring and
 * accessible name (label, then state, then description) cannot drift apart.
 * `value` is a ReactNode because the flag tile's state is text, not a count.
 */
function OperationsCard({
  href,
  label,
  value,
  description,
  needsAttention = false,
}: {
  href: string;
  label: string;
  value: ReactNode;
  description: string;
  needsAttention?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex min-h-40 flex-col justify-between border-b border-r border-rule p-5 transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        needsAttention
          ? "bg-warning/10 hover:bg-warning/20"
          : "bg-ground hover:bg-surface",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="type-body-sm font-medium text-ink">{label}</span>
        <ArrowUpRight
          className="size-4 text-ink-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </div>
      <div>
        <p className="type-section tabular-nums">{value}</p>
        <p className="mt-1 type-body-sm">{description}</p>
      </div>
    </Link>
  );
}

type Metric = {
  key: keyof AdminOperationsMetrics;
  label: string;
  description: string;
  href: string;
  requiresAction: boolean;
};

const metrics: Metric[] = [
  {
    key: "needsData",
    label: "Needs data",
    description: "Submissions awaiting enrichment",
    href: routes.admin.submissions({ stage: "needs_data" }),
    requiresAction: true,
  },
  {
    key: "ready",
    label: "Ready",
    description: "Submissions ready for review",
    href: routes.admin.submissions({ stage: "ready" }),
    requiresAction: true,
  },
  {
    key: "moderation",
    label: "Content flags",
    description: "Pending moderation decisions",
    href: routes.admin.moderation(),
    requiresAction: true,
  },
  {
    key: "claims",
    label: "Claims",
    description: "Ownership requests awaiting review",
    href: routes.admin.claims(),
    requiresAction: true,
  },
  {
    key: "reports",
    label: "Reports",
    description: "Open brand reports",
    href: routes.admin.reports(),
    requiresAction: true,
  },
  {
    key: "activeJobs",
    label: "Active jobs",
    description: "Pending or running data jobs",
    href: routes.admin.jobs(),
    requiresAction: true,
  },
  {
    key: "brands",
    label: "Total brands",
    description: "Records in the brand catalog",
    href: routes.admin.brands(),
    requiresAction: false,
  },
  {
    key: "subscribers",
    label: "Subscribers",
    description: "Active newsletter subscribers",
    href: routes.admin.newsletter() + "?status=active",
    requiresAction: false,
  },
];

export default async function AdminPage() {
  const [snapshot, t, ownerFeaturesEnabled] = await Promise.all([
    getAdminOperationsSnapshot(),
    getTranslations("admin.dashboard"),
    isOwnerFeaturesEnabled(),
  ]);
  const dashboardMetrics: Metric[] = [
    ...metrics.slice(0, 3),
    {
      key: "evidence",
      label: t("evidence.label"),
      description: t("evidence.description"),
      href: routes.admin.evidence(),
      requiresAction: true,
    },
    ...metrics.slice(3),
  ];

  return (
    <div className="space-y-stack">
      <section aria-labelledby="operations-overview-heading">
        <div className="mb-5 max-w-2xl">
          <h2
            id="operations-overview-heading"
            className="type-label"
          >
            Operations overview
          </h2>
          <p className="mt-1 type-body-sm">
            Triage the queues that need a decision, then open the workspace that
            owns the work.
          </p>
        </div>
        <div className="grid overflow-hidden rounded-[3px] border-l border-t border-rule sm:grid-cols-2 xl:grid-cols-5">
          {dashboardMetrics.map((metric) => {
            const value = snapshot.metrics[metric.key];
            return (
              <OperationsCard
                key={metric.key}
                href={metric.href}
                label={metric.label}
                value={value ?? "—"}
                description={
                  value === null ? "Unavailable" : metric.description
                }
                needsAttention={
                  metric.requiresAction && value !== null && value > 0
                }
              />
            );
          })}
          {/* State is conveyed as text, never colour alone, so the accessible
              name reads "Owner features / Disabled / Manage feature flags". */}
          <OperationsCard
            href={routes.admin.settings()}
            label={t("ownerFeatures.label")}
            value={
              ownerFeaturesEnabled
                ? t("ownerFeatures.enabled")
                : t("ownerFeatures.disabled")
            }
            description={t("ownerFeatures.manage")}
          />
        </div>
      </section>

      <section
        aria-labelledby="quick-operations-heading"
        className="border-t border-rule pt-8"
      >
        <div className="mb-4">
          <h2 id="quick-operations-heading" className="type-label">
            Quick operations
          </h2>
        </div>
        <AdminQuickActions needsDataCount={snapshot.metrics.needsData} />
      </section>

      <section
        aria-labelledby="recent-jobs-heading"
        className="border-t border-rule pt-8"
      >
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 id="recent-jobs-heading" className="type-label">
              Recent data jobs
            </h2>
            <p className="mt-1 type-body-sm">
              The five newest runs, ordered by creation time.
            </p>
          </div>
          <Link
            href={routes.admin.jobs()}
            className="inline-flex min-h-12 items-center text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            View all jobs
          </Link>
        </div>
        <div className="divide-y divide-rule border-y border-rule">
          {snapshot.recentJobs.length === 0 ? (
            <p className="py-8 text-center text-ink-muted">
              No data jobs yet.
            </p>
          ) : (
            snapshot.recentJobs.map((job) => (
              <Link
                key={job.id}
                href={routes.admin.job(job.id)}
                className="grid min-h-16 gap-2 py-3 transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:grid-cols-[minmax(220px,1fr)_auto_auto] sm:items-center sm:px-3"
              >
                <span className="font-medium">
                  {formatJobDate(job.created_at)}
                </span>
                <span className="type-body-sm">
                  {job.succeeded_count +
                    job.skipped_count +
                    job.failed_count +
                    (job.cancelled_count ?? 0)}{" "}
                  / {job.target_total}
                </span>
                <JobStatusBadge job={job} />
              </Link>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
