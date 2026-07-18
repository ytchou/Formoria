"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { toast } from "sonner";
import {
  approveSubmissionAction,
  rejectSubmissionAction,
} from "@/app/admin/actions";
import { JobAutoRefresh } from "@/app/admin/jobs/job-auto-refresh";
import { startCurationJobAction } from "@/app/admin/operations/actions";
import { SubmissionStatusBadge } from "@/components/admin/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DenialReason, SubmissionIntent } from "@/lib/types";
import { DENIAL_REASONS } from "@/lib/types";
import type {
  BrandSubmissionForReview,
  EnrichmentFilter,
} from "@/lib/services/submissions";
import { SubmissionReviewDetails } from "./submission-review-details";

export type TabValue =
  "all" | "needs_data" | "enriching" | "ready" | "approved" | "rejected";

export type ReviewSubmission = BrandSubmissionForReview & {
  moderationRiskLevel?: "high" | "medium" | "clean";
  brandSlug?: string | null;
};

const PAGE_SIZES = [10, 25, 50] as const;
const BULK_DENIAL_REASONS = DENIAL_REASONS.filter(
  (reason) => reason !== "other" && reason !== "admin_reject",
);
const GENERATED_GUEST_EMAIL_SUFFIX = "@guest.formoria.invalid";

export function SubmissionsReviewList({
  submissions,
  initialTab = "needs_data",
}: {
  submissions: ReviewSubmission[];
  initialTab?: TabValue;
}) {
  const t = useTranslations("admin.submissions");
  const denialReasonsT = useTranslations("admin.submissions.denialReasons");
  const moderationT = useTranslations("admin.moderation");
  const router = useRouter();
  const pathname = usePathname();
  const [activeTab, setActiveTab] = useState<TabValue>(initialTab);
  const [enrichmentFilter, setEnrichmentFilter] =
    useState<EnrichmentFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(10);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bulkRejecting, setBulkRejecting] = useState(false);
  const [bulkRejectReason, setBulkRejectReason] = useState<DenialReason | "">(
    "",
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isEnriching, startEnrichTransition] = useTransition();

  const tabCounts = useMemo(
    () => ({
      all: submissions.length,
      needs_data: submissions.filter(
        (item) => item.reviewStage === "needs_data",
      ).length,
      enriching: submissions.filter((item) => item.reviewStage === "enriching")
        .length,
      ready: submissions.filter((item) => item.reviewStage === "ready").length,
      approved: submissions.filter((item) => item.status === "approved").length,
      rejected: submissions.filter((item) => item.status === "rejected").length,
    }),
    [submissions],
  );

  const stageFiltered = useMemo(
    () => submissions.filter((submission) => matchesTab(submission, activeTab)),
    [activeTab, submissions],
  );
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return stageFiltered.filter((submission) => {
      if (
        enrichmentFilter === "complete" &&
        !submission.reviewCompleteness.complete
      )
        return false;
      if (
        enrichmentFilter === "incomplete" &&
        submission.reviewCompleteness.complete
      )
        return false;
      if (!query) return true;

      return [
        submission.brandName,
        submission.reviewData.name,
        submission.submitterName,
        submission.submitterEmail,
        submission.reviewData.websiteUrl,
      ].some((value) => value?.toLocaleLowerCase().includes(query));
    });
  }, [enrichmentFilter, search, stageFiltered]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const selectableVisible = visible.filter(
    (submission) => submission.status === "pending",
  );
  const selectedVisible = selectableVisible.filter((submission) =>
    selectedIds.has(submission.id),
  );
  const allSelected =
    selectableVisible.length > 0 &&
    selectedVisible.length === selectableVisible.length;
  const someSelected = selectedVisible.length > 0 && !allSelected;

  function resetView() {
    setPage(1);
    setSelectedIds(new Set());
    setBulkRejecting(false);
    setBulkRejectReason("");
    setError(null);
  }

  function toggleSelection(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(
      new Set(selectableVisible.map((submission) => submission.id)),
    );
  }

  function toggleExpanded(id: string) {
    setExpandedId((current) => (current === id ? null : id));
  }

  function approveOne(id: string) {
    startTransition(async () => {
      setError(null);
      const result = await approveSubmissionAction(id);
      if (result?.error) setError(result.error);
      else router.refresh();
    });
  }

  function rejectOne(id: string) {
    if (!confirm(t("confirmReject"))) return;
    startTransition(async () => {
      setError(null);
      const result = await rejectSubmissionAction(id, "admin_reject", "");
      if (result?.error) setError(result.error);
      else router.refresh();
    });
  }

  function bulkApprove() {
    const approvals = selectedVisible.filter(
      (submission) => submission.reviewCompleteness.complete,
    );
    if (approvals.length === 0) return;
    if (!confirm(t("confirmBulkApprove", { count: approvals.length }))) return;

    startTransition(async () => {
      setError(null);
      const results = await Promise.all(
        approvals.map(async (submission) => ({
          submission,
          result: await approveSubmissionAction(submission.id),
        })),
      );
      const failed = results.find(({ result }) => result?.error);
      if (failed?.result?.error) {
        setError(`${failed.submission.brandName}: ${failed.result.error}`);
        return;
      }
      setSelectedIds(new Set());
      router.refresh();
    });
  }

  function bulkReject() {
    if (!bulkRejecting) {
      setBulkRejecting(true);
      return;
    }
    if (!bulkRejectReason) return;

    startTransition(async () => {
      const results = await Promise.all(
        selectedVisible.map((submission) =>
          rejectSubmissionAction(submission.id, bulkRejectReason, ""),
        ),
      );
      const failed = results.find((result) => result?.error);
      if (failed?.error) {
        setError(failed.error);
        return;
      }
      setSelectedIds(new Set());
      setBulkRejecting(false);
      setBulkRejectReason("");
      router.refresh();
    });
  }

  function enrichSelected() {
    const ids = selectedVisible
      .filter((submission) => submission.reviewStage === "needs_data")
      .map((submission) => submission.id);
    if (ids.length === 0) return;

    startEnrichTransition(async () => {
      const result = await startCurationJobAction(
        "enrich",
        { submissionIds: ids },
        false,
      );
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      if ("queued" in result) {
        const notify =
          result.dispatchStatus === "failed" ? toast.error : toast.info;
        notify(result.message, {
          action: {
            label: t("viewJob"),
            onClick: () => router.push(result.detailPath),
          },
        });
        setSelectedIds(new Set());
        router.refresh();
      }
    });
  }

  return (
    <div>
      <JobAutoRefresh
        active={submissions.some((item) => item.reviewStage === "enriching")}
      />
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const next = value as TabValue;
          setActiveTab(next);
          resetView();
          router.replace(`${pathname}?stage=${next}`);
        }}
      >
        <TabsList className="max-w-full overflow-x-auto">
          {(
            [
              "needs_data",
              "enriching",
              "ready",
              "approved",
              "rejected",
              "all",
            ] as const
          ).map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {t(`tabs.${tabKey(tab)}`)} ({tabCounts[tab]})
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(260px,1fr)_220px_auto] lg:items-center">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              resetView();
            }}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchLabel")}
            className="pl-9"
          />
        </div>
        <Select
          value={enrichmentFilter}
          onValueChange={(value) => {
            setEnrichmentFilter(value as EnrichmentFilter);
            resetView();
          }}
        >
          <SelectTrigger aria-label={t("enrichmentFilter.label")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("enrichmentFilter.all")}</SelectItem>
            <SelectItem value="complete">
              {t("enrichmentFilter.complete")}
            </SelectItem>
            <SelectItem value="incomplete">
              {t("enrichmentFilter.incomplete")}
            </SelectItem>
          </SelectContent>
        </Select>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            size="compact"
            className="min-h-12"
            onClick={enrichSelected}
            disabled={selectedVisible.length === 0 || isEnriching}
          >
            {isEnriching ? t("fetching") : t("fetchData")}
          </Button>
          <Button
            aria-label={t("bulkApprove")}
            size="compact"
            className="min-h-12"
            variant="primary"
            onClick={bulkApprove}
            disabled={
              isPending ||
              !selectedVisible.some((item) => item.reviewCompleteness.complete)
            }
          >
            {t("approve")}
          </Button>
          <Button
            aria-label={t("bulkReject")}
            size="compact"
            className="min-h-12"
            variant="destructive"
            onClick={bulkReject}
            disabled={
              isPending ||
              selectedVisible.length === 0 ||
              (bulkRejecting && !bulkRejectReason)
            }
          >
            {bulkRejecting ? t("confirmBulkReject") : t("reject")}
          </Button>
        </div>
      </div>

      {bulkRejecting && selectedVisible.length > 0 && (
        <div className="mt-3 max-w-sm space-y-2 rounded-md border bg-background p-3">
          <Label>{t("bulkRejectReason")}</Label>
          <Select
            value={bulkRejectReason}
            onValueChange={(value) =>
              setBulkRejectReason(value as DenialReason)
            }
          >
            <SelectTrigger aria-label={t("bulkRejectAriaLabel")}>
              <SelectValue placeholder={t("selectReason")} />
            </SelectTrigger>
            <SelectContent>
              {BULK_DENIAL_REASONS.map((reason) => (
                <SelectItem key={reason} value={reason}>
                  {denialReasonsT(reason)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {error && <p className="mt-3 type-error">{error}</p>}

      <div className="mt-4 overflow-x-auto rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                <Checkbox
                  aria-label={t("selectVisible")}
                  checked={allSelected}
                  indeterminate={someSelected}
                  onCheckedChange={toggleSelectAll}
                />
              </TableHead>
              <TableHead>{t("table.brand")}</TableHead>
              <TableHead>{t("table.source")}</TableHead>
              <TableHead>{t("table.status")}</TableHead>
              <TableHead>{t("table.enrichment")}</TableHead>
              <TableHead>{t("table.submitter")}</TableHead>
              <TableHead>{t("table.date")}</TableHead>
              <TableHead className="text-right">{t("table.actions")}</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">{t("table.details")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((submission) => {
              const expanded = expandedId === submission.id;
              const intent = getSubmissionIntent(submission);
              const enrichment = enrichmentLabel(submission, t);
              return (
                <Fragment key={submission.id}>
                  <TableRow
                    className="cursor-pointer hover:bg-secondary"
                    onClick={(event) => {
                      if (isInteractiveTarget(event.target)) return;
                      toggleExpanded(submission.id);
                    }}
                  >
                    <TableCell>
                      <Checkbox
                        aria-label={t("selectSubmission", {
                          name: submission.brandName,
                        })}
                        checked={selectedIds.has(submission.id)}
                        disabled={submission.status !== "pending"}
                        onCheckedChange={() => toggleSelection(submission.id)}
                      />
                    </TableCell>
                    <TableCell className="max-w-[240px] font-medium">
                      <div className="flex items-center gap-2">
                        <span className="truncate">
                          {submission.reviewData.name}
                        </span>
                        {submission.moderationRiskLevel === "high" && (
                          <Badge variant="destructive">
                            {moderationT("riskHigh")}
                          </Badge>
                        )}
                        {submission.moderationRiskLevel === "medium" && (
                          <Badge variant="verified">
                            {moderationT("riskMedium")}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {intent === "owner_claim"
                          ? t("intent.ownerClaim")
                          : t("intent.recommend")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <SubmissionStatusBadge status={submission.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant={enrichment.variant}>
                          {enrichment.label}
                        </Badge>
                        {submission.latestCurationJobId && (
                          <Link
                            className="type-link"
                            href={`/admin/jobs/${submission.latestCurationJobId}`}
                          >
                            {t("viewJob")}
                          </Link>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <span className="block truncate">
                        {submission.submitterName ||
                          getSubmitterLabel(
                            submission.submitterEmail,
                            t("noSubmitter"),
                          )}
                      </span>
                      {submission.submitterName && (
                        <span className="block truncate type-caption">
                          {getSubmitterLabel(
                            submission.submitterEmail,
                            t("noSubmitter"),
                          )}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{formatDate(submission.submittedAt)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {submission.status === "pending" && (
                          <Button
                            size="compact"
                            className="min-h-12"
                            variant="primary"
                            onClick={() => approveOne(submission.id)}
                            disabled={
                              isPending ||
                              !submission.reviewCompleteness.complete
                            }
                          >
                            {t("approve")}
                          </Button>
                        )}
                        {submission.status === "pending" && (
                          <Button
                            size="compact"
                            className="min-h-12"
                            variant="destructive"
                            onClick={() => rejectOne(submission.id)}
                            disabled={isPending}
                          >
                            {t("reject")}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        shape="pill"
                        variant="ghost"
                        className="h-12 w-12 p-0"
                        onClick={() => toggleExpanded(submission.id)}
                        aria-expanded={expanded}
                        aria-controls={`submission-review-${submission.id}`}
                        aria-label={
                          expanded
                            ? t("collapseReview", {
                                name: submission.brandName,
                              })
                            : t("expandReview", { name: submission.brandName })
                        }
                      >
                        <ChevronDown
                          className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`}
                          aria-hidden="true"
                        />
                      </Button>
                    </TableCell>
                  </TableRow>
                  {expanded && (
                    <TableRow>
                      <TableCell colSpan={9} className="bg-background p-6">
                        <SubmissionReviewDetails submission={submission} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
            {visible.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="py-10 text-center type-body-muted"
                >
                  {t("notFound")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="type-card-description">
          {t("pagination.summary", {
            from: filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1,
            to: Math.min(currentPage * pageSize, filtered.length),
            total: filtered.length,
          })}
        </p>
        <div className="flex items-center gap-2">
          <Select
            value={pageSize.toString()}
            onValueChange={(value) => {
              setPageSize(Number(value) as (typeof PAGE_SIZES)[number]);
              resetView();
            }}
          >
            <SelectTrigger
              aria-label={t("pagination.pageSize")}
              className="w-24"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={size.toString()}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            shape="pill"
            variant="secondary"
            className="h-12 w-12 p-0"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={currentPage === 1}
            aria-label={t("pagination.previous")}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-16 text-center type-card-description">
            {currentPage} / {pageCount}
          </span>
          <Button
            shape="pill"
            variant="secondary"
            className="h-12 w-12 p-0"
            onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
            disabled={currentPage === pageCount}
            aria-label={t("pagination.next")}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function matchesTab(submission: ReviewSubmission, tab: TabValue) {
  if (tab === "all") return true;
  if (tab === "approved" || tab === "rejected")
    return submission.status === tab;
  return submission.reviewStage === tab;
}

function tabKey(tab: TabValue) {
  if (tab === "needs_data") return "needsData" as const;
  return tab;
}

function getSubmissionIntent(submission: ReviewSubmission): SubmissionIntent {
  return (
    submission.intent ?? (submission.isBrandOwner ? "owner_claim" : "recommend")
  );
}

function getSubmitterLabel(email: string, fallback: string) {
  return email.endsWith(GENERATED_GUEST_EMAIL_SUFFIX) ? fallback : email;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Taipei",
  });
}

function enrichmentLabel(
  submission: ReviewSubmission,
  t: ReturnType<typeof useTranslations<"admin.submissions">>,
): { label: string; variant: "verified" | "secondary" | "destructive" } {
  if (submission.reviewStage === "enriching") {
    return {
      label:
        submission.latestCurationTargetStatus === "running"
          ? t("enrichmentStatus.running")
          : t("enrichmentStatus.queued"),
      variant: "secondary",
    };
  }
  if (
    submission.latestCurationTargetStatus === "failed" ||
    submission.latestCurationDispatchStatus === "failed" ||
    submission.latestCurationJobStatus === "failed" ||
    submission.latestCurationJobStatus === "cancelled"
  ) {
    return { label: t("enrichmentStatus.failed"), variant: "destructive" };
  }
  if (submission.latestCurationTargetStatus === "skipped") {
    return { label: t("enrichmentStatus.skipped"), variant: "secondary" };
  }
  return submission.reviewCompleteness.complete
    ? { label: t("enrichmentStatus.complete"), variant: "verified" }
    : { label: t("enrichmentStatus.partial"), variant: "secondary" };
}

function isInteractiveTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        "button, a, input, select, textarea, [role='checkbox'], [role='combobox']",
      ),
    )
  );
}
