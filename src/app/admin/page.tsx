import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { AdminQuickActions } from "@/components/admin/admin-quick-actions";
import { JobStatusBadge, formatJobDate } from "@/app/admin/jobs/job-display";
import {
  getAdminOperationsSnapshot,
  type AdminOperationsMetrics,
} from "@/lib/services/admin-operations";
import { cn } from "@/lib/utils";

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
    href: "/admin/submissions?stage=needs_data",
    requiresAction: true,
  },
  {
    key: "ready",
    label: "Ready",
    description: "Submissions ready for review",
    href: "/admin/submissions?stage=ready",
    requiresAction: true,
  },
  {
    key: "moderation",
    label: "Content flags",
    description: "Pending moderation decisions",
    href: "/admin/moderation",
    requiresAction: true,
  },
  {
    key: "claims",
    label: "Claims",
    description: "Ownership requests awaiting review",
    href: "/admin/claims",
    requiresAction: true,
  },
  {
    key: "reports",
    label: "Reports",
    description: "Open brand reports",
    href: "/admin/reports",
    requiresAction: true,
  },
  {
    key: "activeJobs",
    label: "Active jobs",
    description: "Pending or running data jobs",
    href: "/admin/jobs",
    requiresAction: true,
  },
  {
    key: "brands",
    label: "Total brands",
    description: "Records in the brand catalog",
    href: "/admin/brands",
    requiresAction: false,
  },
  {
    key: "subscribers",
    label: "Subscribers",
    description: "Active newsletter subscribers",
    href: "/admin/newsletter?status=active",
    requiresAction: false,
  },
];

export default async function AdminPage() {
  const [snapshot, t] = await Promise.all([
    getAdminOperationsSnapshot(),
    getTranslations("admin.dashboard"),
  ]);
  const dashboardMetrics: Metric[] = [
    ...metrics.slice(0, 3),
    {
      key: "evidence",
      label: t("evidence.label"),
      description: t("evidence.description"),
      href: "/admin/evidence",
      requiresAction: true,
    },
    ...metrics.slice(3),
  ];

  return (
    <div className="space-y-10">
      <section aria-labelledby="operations-overview-heading">
        <div className="mb-5 max-w-2xl">
          <h2
            id="operations-overview-heading"
            className="type-section-title-large"
          >
            Operations overview
          </h2>
          <p className="mt-1 type-card-description">
            Triage the queues that need a decision, then open the workspace that
            owns the work.
          </p>
        </div>
        <div className="grid overflow-hidden rounded-xl border-l border-t border-border sm:grid-cols-2 xl:grid-cols-5">
          {dashboardMetrics.map((metric) => {
            const value = snapshot.metrics[metric.key];
            return (
              <Link
                key={metric.key}
                href={metric.href}
                className={cn(
                  "group flex min-h-40 flex-col justify-between border-b border-r border-border p-5 transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  metric.requiresAction && value !== null && value > 0
                    ? "bg-warning/10 hover:bg-warning/20"
                    : "bg-card hover:bg-muted/50",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="type-body-emphasis">{metric.label}</span>
                  <ArrowUpRight
                    className="size-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </div>
                <div>
                  <p className="type-stat">{value ?? "—"}</p>
                  <p className="mt-1 type-card-description">
                    {value === null ? "Unavailable" : metric.description}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section
        aria-labelledby="quick-operations-heading"
        className="border-t border-border pt-8"
      >
        <div className="mb-4">
          <h2 id="quick-operations-heading" className="type-card-title">
            Quick operations
          </h2>
        </div>
        <AdminQuickActions needsDataCount={snapshot.metrics.needsData} />
      </section>

      <section
        aria-labelledby="recent-jobs-heading"
        className="border-t border-border pt-8"
      >
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 id="recent-jobs-heading" className="type-card-title">
              Recent data jobs
            </h2>
            <p className="mt-1 type-card-description">
              The five newest runs, ordered by creation time.
            </p>
          </div>
          <Link
            href="/admin/jobs"
            className="inline-flex min-h-12 items-center text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            View all jobs
          </Link>
        </div>
        <div className="divide-y divide-border border-y border-border">
          {snapshot.recentJobs.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No data jobs yet.
            </p>
          ) : (
            snapshot.recentJobs.map((job) => (
              <Link
                key={job.id}
                href={`/admin/jobs/${job.id}`}
                className="grid min-h-16 gap-2 py-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(220px,1fr)_auto_auto] sm:items-center sm:px-3"
              >
                <span className="font-medium">
                  {formatJobDate(job.created_at)}
                </span>
                <span className="text-sm text-muted-foreground">
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
