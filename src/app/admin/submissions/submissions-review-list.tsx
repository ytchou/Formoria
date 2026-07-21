"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
} from "lucide-react";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DenialReason } from "@/lib/types";
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
  const [submittedFrom, setSubmittedFrom] = useState("");
  const [submittedTo, setSubmittedTo] = useState("");
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
      const submittedDate = formatTaipeiDate(submission.submittedAt);
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
      if (submittedFrom && submittedDate < submittedFrom) return false;
      if (submittedTo && submittedDate > submittedTo) return false;
      if (!query) return true;

      return [
        submission.brandName,
        submission.reviewData.name,
        submission.submitterName,
        submission.submitterEmail,
        submission.reviewData.websiteUrl,
      ].some((value) => value?.toLocaleLowerCase().includes(query));
    });
  }, [enrichmentFilter, search, stageFiltered, submittedFrom, submittedTo]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const expandedSubmission =
    submissions.find((submission) => submission.id === expandedId) ?? null;
  const selectableVisible = visible.filter(
    (submission) =>
      submission.status === "pending" &&
      !(activeTab === "needs_data" && submission.reviewKind === "refresh"),
  );
  const selectedVisible = selectableVisible.filter((submission) =>
    selectedIds.has(submission.id),
  );
  const approvableSelected = selectedVisible.filter(
    (submission) => submission.reviewCompleteness.complete,
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
    setExpandedId(null);
  }

  function selectSubmittedDate(value: string) {
    if (!value) return;

    if (!submittedFrom || submittedTo) {
      setSubmittedFrom(value);
      setSubmittedTo("");
    } else if (value < submittedFrom) {
      setSubmittedFrom(value);
      setSubmittedTo(submittedFrom);
    } else {
      setSubmittedTo(value);
    }
    resetView();
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
      else {
        if (result?.storageCleanupWarning) {
          toast.warning(t("storageCleanupWarning"));
        }
        router.refresh();
      }
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
    if (approvableSelected.length === 0) return;
    if (!confirm(t("confirmBulkApprove", { count: approvableSelected.length })))
      return;

    startTransition(async () => {
      setError(null);
      const results = await Promise.all(
        approvableSelected.map(async (submission) => ({
          submission,
          result: await approveSubmissionAction(submission.id),
        })),
      );
      const failed = results.find(({ result }) => result?.error);
      if (failed?.result?.error) {
        setError(`${failed.submission.brandName}: ${failed.result.error}`);
        return;
      }
      if (results.some(({ result }) => result?.storageCleanupWarning)) {
        toast.warning(t("storageCleanupWarning"));
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

      <div className="mt-4 grid gap-3 lg:grid-cols-2 lg:items-center xl:grid-cols-[minmax(260px,1fr)_220px_minmax(340px,auto)_auto]">
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
        <div className="relative">
          <Input
            type="date"
            value=""
            aria-label={`${t("submittedDate.from")} / ${t("submittedDate.to")}`}
            className="cursor-pointer text-transparent"
            onClick={(event) => event.currentTarget.showPicker?.()}
            onChange={(event) => selectSubmittedDate(event.target.value)}
          />
          <div
            className="pointer-events-none absolute inset-y-0 left-3.5 right-12 flex items-center gap-2"
            aria-hidden="true"
          >
            <CalendarRange
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span
              className={`min-w-0 truncate ${submittedFrom ? "type-body" : "type-body-muted"}`}
            >
              {submittedFrom
                ? `${submittedFrom} – ${submittedTo || t("submittedDate.to")}`
                : `${t("submittedDate.from")} – ${t("submittedDate.to")}`}
            </span>
          </div>
          {submittedFrom && (
            <Button
              type="button"
              variant="ghost"
              shape="square"
              size="icon"
              className="absolute right-1 top-1 z-10 size-10"
              aria-label={`${t("fields.remove")} ${t("submittedDate.from")} / ${t("submittedDate.to")}`}
              onClick={() => {
                setSubmittedFrom("");
                setSubmittedTo("");
                resetView();
              }}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {activeTab === "needs_data" ? (
            <Button
              size="compact"
              className="min-h-12"
              onClick={enrichSelected}
              disabled={selectedVisible.length === 0 || isEnriching}
            >
              {isEnriching ? t("fetching") : t("fetchData")}
            </Button>
          ) : (
            <>
              <Button
                aria-label={t("approveSelected", {
                  count: approvableSelected.length,
                })}
                size="compact"
                className="min-h-12"
                variant="primary"
                onClick={bulkApprove}
                disabled={isPending || approvableSelected.length === 0}
              >
                {t("approveSelected", { count: approvableSelected.length })}
              </Button>
              <Button
                aria-label={
                  bulkRejecting
                    ? t("confirmRejectSelected", {
                        count: selectedVisible.length,
                      })
                    : t("rejectSelected", { count: selectedVisible.length })
                }
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
                {bulkRejecting
                  ? t("confirmRejectSelected", {
                      count: selectedVisible.length,
                    })
                  : t("rejectSelected", { count: selectedVisible.length })}
              </Button>
            </>
          )}
        </div>
      </div>

      {activeTab !== "needs_data" &&
        bulkRejecting &&
        selectedVisible.length > 0 && (
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
              <TableHead>{t("table.status")}</TableHead>
              <TableHead>{t("table.submitter")}</TableHead>
              <TableHead>{t("table.date")}</TableHead>
              <TableHead>{t("table.enrichment")}</TableHead>
              <TableHead className="text-right">{t("table.actions")}</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">{t("table.details")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((submission) => {
              const expanded = expandedId === submission.id;
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
                        disabled={
                          submission.status !== "pending" ||
                          (activeTab === "needs_data" &&
                            submission.reviewKind === "refresh")
                        }
                        onCheckedChange={() => toggleSelection(submission.id)}
                      />
                    </TableCell>
                    <TableCell className="max-w-[240px] font-medium">
                      <div className="flex items-center gap-2">
                        <span className="truncate">
                          {submission.reviewData.name}
                        </span>
                        {submission.reviewKind === "refresh" && (
                          <Badge variant="secondary">{t("refreshBadge")}</Badge>
                        )}
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
                      <SubmissionStatusBadge status={submission.status} />
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
                      {submission.reviewCompleteness.missingFields.length >
                        0 && (
                        <p className="mt-1 type-caption text-warning">
                          {`${t("missingRequired")}: ${submission.reviewCompleteness.missingFields
                            .map((field) => t(`missingFields.${field}`))
                            .join(", ")}`}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {submission.status === "pending" &&
                          submission.reviewStage !== "needs_data" && (
                            <>
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
                                {submission.reviewKind === "refresh"
                                  ? t("applyRefresh")
                                  : t("approve")}
                              </Button>
                              <Button
                                size="compact"
                                className="min-h-12"
                                variant="destructive"
                                onClick={() => rejectOne(submission.id)}
                                disabled={isPending}
                              >
                                {t("reject")}
                              </Button>
                            </>
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
                </Fragment>
              );
            })}
            {visible.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-10 text-center type-body-muted"
                >
                  {t("notFound")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet
        open={Boolean(expandedSubmission)}
        onOpenChange={(open) => {
          if (open) return;
          setExpandedId(null);
        }}
      >
        <SheetContent
          side="right"
          className="gap-0 p-0 data-[side=right]:w-[calc(100vw-1rem)] data-[side=right]:max-w-none data-[side=right]:sm:w-3/4 data-[side=right]:sm:max-w-6xl"
        >
          {expandedSubmission && (
            <>
              <SheetHeader className="border-b p-5 pr-16">
                <SheetTitle>
                  <span className="flex items-center gap-2">
                    {expandedSubmission.reviewData.name ||
                      expandedSubmission.brandName}
                    {expandedSubmission.reviewKind === "refresh" && (
                      <Badge variant="secondary">{t("refreshBadge")}</Badge>
                    )}
                  </span>
                </SheetTitle>
                <p className="type-metadata">
                  {formatDate(expandedSubmission.submittedAt)}
                </p>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto p-5">
                <SubmissionReviewDetails
                  key={expandedSubmission.id}
                  submission={expandedSubmission}
                />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

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

function formatTaipeiDate(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Taipei",
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function enrichmentLabel(
  submission: ReviewSubmission,
  t: ReturnType<typeof useTranslations<"admin.submissions">>,
): {
  label: string;
  variant: "verified" | "secondary" | "destructive" | "warning";
} {
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
    : { label: t("enrichmentStatus.partial"), variant: "warning" };
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
