"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  DENIAL_REASONS,
  type BrandSubmission,
  type DenialReason,
  type OtherUrl,
  type SubmissionIntent,
  type SourceAttribution,
} from "@/lib/types";
import {
  getEnrichmentCompleteness,
  type EnrichedData,
} from "@/lib/types/enriched-data";
import { SubmissionStatusBadge } from "@/components/admin/status-badge";
import { rejectSubmissionAction } from "@/app/admin/actions";
import {
  approveSubmissionWithOverridesAction,
  type SubmissionApprovalOverrides,
} from "./actions";
import { startCurationJobAction } from "@/app/admin/operations/actions";
import { PRODUCT_TYPE_CATEGORIES } from "@/lib/taxonomy/ontology";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SurfaceCard } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
import { Textarea } from "@/components/ui/textarea";
import { JobAutoRefresh } from "@/app/admin/jobs/job-auto-refresh";
import type { SubmissionReviewStage } from "@/lib/services/submission-review-stage";

export type TabValue =
  | "all"
  | "needs_data"
  | "enriching"
  | "ready"
  | "approved"
  | "rejected";
type IntentFilter = "all" | SubmissionIntent;

type BrandSubmissionWithRisk = BrandSubmission & {
  moderationRiskLevel?: "high" | "medium" | "clean";
  productTypeNote?: string | null;
  enriched_data?: EnrichedData | null;
  brandSlug?: string | null;
  latestCurationTargetStatus?:
    | "pending"
    | "running"
    | "succeeded"
    | "skipped"
    | "failed"
    | null;
  latestCurationJobId?: string | null;
  latestCurationPhase?: string | null;
  latestCurationError?: string | null;
  latestCurationJobStatus?: string | null;
  latestCurationDispatchStatus?: "pending" | "dispatched" | "failed" | null;
  reviewStage?: SubmissionReviewStage;
};

type OverrideForm = Required<Omit<SubmissionApprovalOverrides, "otherUrls">> & {
  otherUrls: OtherUrl[];
};

const PRODUCT_TYPE_EMPTY = "__none";
const BULK_DENIAL_REASONS = DENIAL_REASONS.filter(
  (reason) => reason !== "other" && reason !== "admin_reject",
);

type EnrichmentStatus = "not_enriched" | "enriched" | "partially_enriched";
const GENERATED_GUEST_EMAIL_SUFFIX = "@guest.formoria.invalid";

function getSubmissionIntent(
  submission: Pick<BrandSubmission, "intent" | "isBrandOwner">,
): SubmissionIntent {
  if (submission.intent) return submission.intent;
  return submission.isBrandOwner ? "owner_claim" : "recommend";
}

function getSubmitterLabel(
  submission: Pick<BrandSubmission, "submitterEmail">,
  noSubmitterLabel: string,
) {
  return submission.submitterEmail.endsWith(GENERATED_GUEST_EMAIL_SUFFIX)
    ? noSubmitterLabel
    : submission.submitterEmail;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Taipei",
  });
}

function readinessBadgeClass(tone: "green" | "amber" | "red" | "grey") {
  switch (tone) {
    case "green":
      return "bg-verified-green-bg text-verified-green";
    case "amber":
      return "bg-mit-verified-bg text-mit-verified";
    case "red":
      return "bg-destructive/10 text-destructive";
    case "grey":
      return "bg-secondary text-muted-foreground";
  }
}

function ReadinessBadge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "green" | "amber" | "red" | "grey";
}) {
  return (
    <span
      className={`inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 type-label ${readinessBadgeClass(tone)}`}
    >
      {children}
    </span>
  );
}

function AutoBadge() {
  return (
    <Badge
      variant="outline"
      className="border-dashed bg-background type-eyebrow-muted"
    >
      auto
    </Badge>
  );
}

function FieldLabel({
  children,
  auto,
}: {
  children: React.ReactNode;
  auto?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 type-metadata">
      <span>{children}</span>
      {auto && <AutoBadge />}
    </div>
  );
}

function EnrichedCard({
  children,
  auto,
}: {
  children: React.ReactNode;
  auto?: boolean;
}) {
  return (
    <SurfaceCard
      padding="sm"
      tone={auto ? "background" : "white"}
      className={auto ? "border-dashed" : undefined}
    >
      {children}
    </SurfaceCard>
  );
}

function hasText(value: string | undefined) {
  return (value ?? "").trim() !== "";
}

export function getEnrichmentStatus(
  enriched_data: EnrichedData | null,
  heroImageUrl?: string | null,
): EnrichmentStatus {
  const completeness = getEnrichmentCompleteness(enriched_data, heroImageUrl);
  if (completeness === "complete") return "enriched";
  if (completeness === "partial") return "partially_enriched";
  return "not_enriched";
}

function isReadyForReview(submission: BrandSubmissionWithRisk): boolean {
  return getReviewStage(submission) === "ready";
}

function isEnrichingActive(submission: BrandSubmissionWithRisk): boolean {
  return getReviewStage(submission) === "enriching";
}

function needsDataWork(submission: BrandSubmissionWithRisk): boolean {
  return getReviewStage(submission) === "needs_data";
}

function getReviewStage(
  submission: BrandSubmissionWithRisk,
): SubmissionReviewStage {
  if (submission.reviewStage) return submission.reviewStage;
  if (submission.status === "approved" || submission.status === "rejected") {
    return submission.status;
  }
  if (
    submission.latestCurationTargetStatus === "pending" ||
    submission.latestCurationTargetStatus === "running"
  ) {
    return "enriching";
  }
  if (
    submission.latestCurationTargetStatus === "succeeded" &&
    getEnrichmentCompleteness(
      submission.enriched_data,
      submission.heroImageUrl,
    ) === "complete"
  ) {
    return "ready";
  }
  return "needs_data";
}

function matchesTab(
  submission: BrandSubmissionWithRisk,
  tab: TabValue,
): boolean {
  switch (tab) {
    case "needs_data":
      return needsDataWork(submission);
    case "enriching":
      return isEnrichingActive(submission);
    case "ready":
      return isReadyForReview(submission);
    case "approved":
      return submission.status === "approved";
    case "rejected":
      return submission.status === "rejected";
    case "all":
      return true;
  }
}

function enrichmentLabel(
  submission: BrandSubmissionWithRisk,
  t: ReturnType<typeof useTranslations<"admin.submissions">>,
): {
  label: string;
  tone: "green" | "amber" | "red" | "grey";
} {
  if (submission.latestCurationTargetStatus === "pending")
    return { label: t("enrichmentStatus.queued"), tone: "amber" };
  if (submission.latestCurationTargetStatus === "running")
    return { label: t("enrichmentStatus.running"), tone: "amber" };
  if (submission.latestCurationTargetStatus === "failed")
    return { label: t("enrichmentStatus.failed"), tone: "red" };
  if (submission.latestCurationTargetStatus === "skipped")
    return { label: t("enrichmentStatus.skipped"), tone: "grey" };

  const status = getEnrichmentStatus(
    submission.enriched_data ?? null,
    submission.heroImageUrl,
  );
  if (status === "enriched") return { label: t("enrichmentStatus.complete"), tone: "green" };
  if (status === "partially_enriched") return { label: t("enrichmentStatus.partial"), tone: "amber" };
  return { label: t("enrichmentStatus.none"), tone: "grey" };
}

function getImageCount(
  enrichedData: EnrichedData | null,
  heroImageUrl?: string | null,
) {
  const hasHeroImage =
    hasText(enrichedData?.heroImageUrl) || hasText(heroImageUrl ?? undefined);
  return hasHeroImage ? 1 : 0;
}

function createOverrideForm(submission: BrandSubmissionWithRisk): OverrideForm {
  return {
    description: submission.description ?? "",
    productType: submission.enriched_data?.productType ?? "",
    purchaseWebsite: submission.purchaseWebsite ?? "",
    purchasePinkoi: submission.purchasePinkoi ?? "",
    purchaseShopee: submission.purchaseShopee ?? "",
    socialInstagram: submission.socialInstagram ?? "",
    socialThreads: submission.socialThreads ?? "",
    socialFacebook: submission.socialFacebook ?? "",
    otherUrls: submission.otherUrls ?? [],
  };
}

type StructuredSuggestedTags = {
  values?: string[];
};

function isStructuredSuggestedTags(
  value: unknown,
): value is StructuredSuggestedTags {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStructuredSuggestedTagSections(tags: StructuredSuggestedTags) {
  const values = Array.isArray(tags.values)
    ? tags.values.filter((v): v is string => typeof v === "string")
    : [];

  return { values };
}

export function SubmissionsReviewList({
  submissions,
  initialTab = "needs_data",
}: {
  submissions: BrandSubmissionWithRisk[];
  initialTab?: TabValue;
}) {
  const moderationT = useTranslations("admin.moderation");
  const denialReasonsT = useTranslations("admin.submissions.denialReasons");
  const t = useTranslations("admin.submissions");
  const [activeTab, setActiveTab] = useState<TabValue>(initialTab);
  const [intentFilter, setIntentFilter] = useState<IntentFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<DenialReason | "">("");
  const [rejectNotes, setRejectNotes] = useState("");
  const [isBulkRejecting, setIsBulkRejecting] = useState(false);
  const [bulkRejectReason, setBulkRejectReason] = useState<DenialReason | "">(
    "",
  );
  const [bulkRejectError, setBulkRejectError] = useState<string | null>(null);
  const [overridesById, setOverridesById] = useState<
    Record<string, OverrideForm>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isEnriching, startEnrichTransition] = useTransition();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const router = useRouter();
  const pathname = usePathname();

  const statusFiltered = submissions.filter((submission) =>
    matchesTab(submission, activeTab),
  );
  const filtered =
    intentFilter === "all"
      ? statusFiltered
      : statusFiltered.filter(
          (submission) => getSubmissionIntent(submission) === intentFilter,
        );

  function handleRowClick(submission: BrandSubmissionWithRisk) {
    setExpandedId((prev) => (prev === submission.id ? null : submission.id));
    setOverridesById((prev) =>
      prev[submission.id]
        ? prev
        : { ...prev, [submission.id]: createOverrideForm(submission) },
    );
    setRejectingId(null);
    setRejectReason("");
    setRejectNotes("");
    setError(null);
  }

  function updateOverride<K extends keyof OverrideForm>(
    id: string,
    key: K,
    value: OverrideForm[K],
  ) {
    setOverridesById((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        [key]: value,
      },
    }));
  }

  function updateOtherUrl(
    id: string,
    index: number,
    key: keyof OtherUrl,
    value: string,
  ) {
    const current = overridesById[id]?.otherUrls ?? [];
    updateOverride(
      id,
      "otherUrls",
      current.map((link, linkIndex) =>
        linkIndex === index ? { ...link, [key]: value } : link,
      ),
    );
  }

  function addOtherUrl(id: string) {
    updateOverride(id, "otherUrls", [
      ...(overridesById[id]?.otherUrls ?? []),
      { label: "", url: "" },
    ]);
  }

  function removeOtherUrl(id: string, index: number) {
    updateOverride(
      id,
      "otherUrls",
      (overridesById[id]?.otherUrls ?? []).filter(
        (_, linkIndex) => linkIndex !== index,
      ),
    );
  }

  function handleApprove(submission: BrandSubmissionWithRisk) {
    startTransition(async () => {
      setError(null);
      const result = await approveSubmissionWithOverridesAction(
        submission.id,
        overridesById[submission.id] ?? createOverrideForm(submission),
      );
      if (result?.error) setError(result.error);
    });
  }

  function handleReject(id: string) {
    if (rejectingId !== id) {
      setRejectingId(id);
      setRejectReason("");
      setRejectNotes("");
      setError(null);
      return;
    }
    if (!rejectReason) {
      setError(t("errors.selectReason"));
      return;
    }
    if (rejectReason === "other" && !rejectNotes.trim()) {
      setError(t("errors.enterNotes"));
      return;
    }
    startTransition(async () => {
      setError(null);
      const result = await rejectSubmissionAction(
        id,
        rejectReason,
        rejectNotes,
      );
      if (result?.error) setError(result.error);
      else {
        setRejectingId(null);
        setRejectReason("");
        setRejectNotes("");
      }
    });
  }

  const tabCounts = useMemo(
    () => ({
      all: submissions.length,
      needs_data: submissions.filter(needsDataWork).length,
      enriching: submissions.filter(isEnrichingActive).length,
      ready: submissions.filter(isReadyForReview).length,
      approved: submissions.filter((s) => s.status === "approved").length,
      rejected: submissions.filter((s) => s.status === "rejected").length,
    }),
    [submissions],
  );
  const intentCounts = useMemo(
    () => ({
      all: submissions.length,
      recommend: submissions.filter(
        (submission) => getSubmissionIntent(submission) === "recommend",
      ).length,
      owner_claim: submissions.filter(
        (submission) => getSubmissionIntent(submission) === "owner_claim",
      ).length,
    }),
    [submissions],
  );

  function handleBulkApprove() {
    const pendingSelected = filtered.filter(
      (s) => isReadyForReview(s) && selectedIds.has(s.id),
    );
    if (pendingSelected.length === 0) return;
    if (!confirm(t("confirmBulkApprove", { count: pendingSelected.length }))) return;
    startTransition(async () => {
      setError(null);
      for (const submission of pendingSelected) {
        const result = await approveSubmissionWithOverridesAction(
          submission.id,
          overridesById[submission.id] ?? createOverrideForm(submission),
        );
        if (result?.error) {
          setError(`${submission.brandName}: ${result.error}`);
          return;
        }
      }
      setSelectedIds(new Set());
    });
  }

  function toggleSelection(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0) {
        setIsBulkRejecting(false);
        setBulkRejectReason("");
        setBulkRejectError(null);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    const selectable = filtered.filter(
      (submission) => submission.status === "pending",
    );
    const allSelectableSelected =
      selectable.length > 0 && selectable.every((s) => selectedIds.has(s.id));
    if (allSelectableSelected) {
      setSelectedIds(new Set());
      setIsBulkRejecting(false);
      setBulkRejectReason("");
      setBulkRejectError(null);
    } else {
      setSelectedIds(new Set(selectable.map((s) => s.id)));
    }
  }

  function handleBulkReject() {
    if (isPending) return;
    const submissionIds = filtered
      .filter(
        (submission) =>
          submission.status === "pending" && selectedIds.has(submission.id),
      )
      .map((submission) => submission.id);
    if (submissionIds.length === 0) return;

    if (!isBulkRejecting) {
      setIsBulkRejecting(true);
      setBulkRejectReason("");
      setBulkRejectError(null);
      return;
    }

    if (!bulkRejectReason) {
      setBulkRejectError(t("errors.selectReason"));
      return;
    }

    startTransition(async () => {
      setBulkRejectError(null);
      const results = await Promise.all(
        submissionIds.map((submissionId) =>
          rejectSubmissionAction(submissionId, bulkRejectReason, ""),
        ),
      );
      const failed = results.find((result) => result?.error);
      if (failed?.error) {
        setBulkRejectError(failed.error);
        return;
      }
      setSelectedIds(new Set());
      setIsBulkRejecting(false);
      setBulkRejectReason("");
      router.refresh();
    });
  }

  function handleEnrichSelected() {
    if (isEnriching) return;
    const submissionIds = filtered
      .filter(
        (submission) =>
          needsDataWork(submission) && selectedIds.has(submission.id),
      )
      .map((submission) => submission.id);
    if (submissionIds.length === 0) return;

    startEnrichTransition(async () => {
      const result = await startCurationJobAction(
        "enrich",
        { submissionIds },
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
        if (result.dispatchStatus !== "failed") {
          setActiveTab("enriching");
          router.replace(`${pathname}?stage=enriching`);
        }
        router.refresh();
        return;
      }
    });
  }

  const selectableFiltered = filtered.filter(
    (submission) => submission.status === "pending",
  );
  const selectedCount = selectedIds.size;
  const allSelected =
    selectableFiltered.length > 0 &&
    selectableFiltered.every((s) => selectedIds.has(s.id));
  const someSelected =
    selectableFiltered.some((s) => selectedIds.has(s.id)) && !allSelected;

  return (
    <div>
      <JobAutoRefresh active={submissions.some(isEnrichingActive)} />
      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          const nextTab = v as TabValue;
          setActiveTab(nextTab);
          setIntentFilter("all");
          setSelectedIds(new Set());
          setIsBulkRejecting(false);
          setBulkRejectReason("");
          setBulkRejectError(null);
          router.replace(`${pathname}?stage=${nextTab}`);
        }}
      >
        <div className="flex items-center justify-between gap-4">
          <TabsList>
            <TabsTrigger value="needs_data">
              {t("tabs.needsData")} ({tabCounts.needs_data})
            </TabsTrigger>
            <TabsTrigger value="enriching">
              {t("tabs.enriching")} ({tabCounts.enriching})
            </TabsTrigger>
            <TabsTrigger value="ready">
              {t("tabs.ready")} ({tabCounts.ready})
            </TabsTrigger>
            <TabsTrigger value="approved">
              {t("tabs.approved")} ({tabCounts.approved})
            </TabsTrigger>
            <TabsTrigger value="rejected">
              {t("tabs.rejected")} ({tabCounts.rejected})
            </TabsTrigger>
            <TabsTrigger value="all">{t("tabs.all")} ({tabCounts.all})</TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2">
            <Select
              value={intentFilter}
              onValueChange={(value) => setIntentFilter(value as IntentFilter)}
            >
              <SelectTrigger
                aria-label={t("intentFilter.ariaLabel")}
                className="w-[220px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="all">
                  {t("intentFilter.all")} ({intentCounts.all})
                </SelectItem>
                <SelectItem value="recommend">
                  {t("intentFilter.recommend")} ({intentCounts.recommend})
                </SelectItem>
                <SelectItem value="owner_claim">
                  {t("intentFilter.ownerClaim")} ({intentCounts.owner_claim})
                </SelectItem>
              </SelectContent>
            </Select>
            {selectedCount > 0 && (
              <span className="type-card-description">
                {t("selectedCount", { count: selectedCount })}
              </span>
            )}
            {bulkRejectError && (
              <span className="text-sm text-destructive">
                {bulkRejectError}
              </span>
            )}
            <Button
              size="compact"
              onClick={handleEnrichSelected}
              disabled={
                selectedCount === 0 || isEnriching || activeTab !== "needs_data"
              }
            >
              {isEnriching ? t("fetching") : t("fetchData")}
            </Button>
            <Button
              size="compact"
              variant="primary"
              onClick={handleBulkApprove}
              disabled={
                selectedCount === 0 || isPending || activeTab !== "ready"
              }
            >
              {t("approve")}
            </Button>
            <Button
              size="compact"
              variant="destructive"
              onClick={handleBulkReject}
              disabled={
                selectedCount === 0 ||
                isPending ||
                (isBulkRejecting && !bulkRejectReason)
              }
            >
              {isBulkRejecting ? t("confirmBulkReject") : t("reject")}
            </Button>
          </div>
        </div>
        {isBulkRejecting && selectedCount > 0 && (
          <div className="mt-3 flex flex-wrap items-end gap-3 rounded-md border bg-background p-3">
            <div className="min-w-[240px] flex-1 space-y-2">
              <Label className="type-subsection-title">
                {t("bulkRejectReason")} <span className="text-destructive">*</span>
              </Label>
              <Select
                value={bulkRejectReason}
                onValueChange={(value) =>
                  setBulkRejectReason(value as DenialReason)
                }
              >
                <SelectTrigger
                  aria-label={t("bulkRejectAriaLabel")}
                  className="h-12 w-full focus-visible:ring-2 focus-visible:ring-primary/60"
                >
                  <SelectValue placeholder={t("selectReason")} />
                </SelectTrigger>
                <SelectContent align="start">
                  {BULK_DENIAL_REASONS.map((reason) => (
                    <SelectItem key={reason} value={reason}>
                      {denialReasonsT(reason)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </Tabs>

      <div className="mt-4 rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <div onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onCheckedChange={toggleSelectAll}
                  />
                </div>
              </TableHead>
              <TableHead>{t("table.brand")}</TableHead>
              <TableHead className="w-16">{t("table.category")}</TableHead>
              <TableHead className="w-16">{t("table.images")}</TableHead>
              <TableHead>{t("table.source")}</TableHead>
              <TableHead>{t("table.status")}</TableHead>
              <TableHead>{t("table.enrichment")}</TableHead>
              <TableHead>{t("table.submitter")}</TableHead>
              <TableHead>{t("table.date")}</TableHead>
              <TableHead className="w-28 text-right">{t("table.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((submission) => {
              const form =
                overridesById[submission.id] ?? createOverrideForm(submission);
              const hasEnrichment = Boolean(submission.enriched_data);
              const submissionIntent = getSubmissionIntent(submission);
              const enrichment = enrichmentLabel(submission, t);
              const readyForReview = isReadyForReview(submission);

              return (
                <Fragment key={submission.id}>
                  <TableRow
                    className="cursor-pointer hover:bg-secondary"
                    onClick={() => handleRowClick(submission)}
                  >
                    <TableCell>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(submission.id)}
                          disabled={submission.status !== "pending"}
                          onCheckedChange={() => toggleSelection(submission.id)}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[200px] font-medium">
                      <div className="flex items-center gap-2">
                        <span className="truncate">{submission.brandName}</span>
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
                      {submission.enriched_data ? (
                        (submission.enriched_data.productType ?? "").trim() ? (
                          <ReadinessBadge tone="green">✓</ReadinessBadge>
                        ) : (
                          <ReadinessBadge tone="amber">!</ReadinessBadge>
                        )
                      ) : (
                        <ReadinessBadge tone="grey">-</ReadinessBadge>
                      )}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const count = getImageCount(
                          submission.enriched_data ?? null,
                          submission.heroImageUrl,
                        );
                        const tone =
                          count >= 2
                            ? "green"
                            : count === 1
                              ? "amber"
                              : submission.enriched_data
                                ? "red"
                                : "grey";

                        return (
                          <ReadinessBadge tone={tone}>
                            {submission.enriched_data || count > 0
                              ? count
                              : "-"}
                          </ReadinessBadge>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      {/* ui-exception: owner-claim badge is Ink (bg-foreground); community-submission uses verified-green — no matching variants */}
                      {submissionIntent === "owner_claim" ? (
                        <Badge className="bg-foreground text-white">
                          {t("intent.ownerClaim")}
                        </Badge>
                      ) : (
                        <Badge className="bg-verified-green-bg text-verified-green">
                          {t("intent.recommend")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <SubmissionStatusBadge status={submission.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <ReadinessBadge tone={enrichment.tone}>
                          {enrichment.label}
                        </ReadinessBadge>
                        {submission.latestCurationJobId && (
                          <Link
                            href={`/admin/jobs/${submission.latestCurationJobId}`}
                            onClick={(event) => event.stopPropagation()}
                            className="text-xs text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {t("viewJob")}
                          </Link>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate">
                      {getSubmitterLabel(submission, t("noSubmitter"))}
                    </TableCell>
                    <TableCell>{formatDate(submission.submittedAt)}</TableCell>
                    <TableCell className="text-right">
                      {submission.status === "pending" && (
                        <div
                          className="flex items-center justify-end gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {readyForReview ? (
                            <Button
                              size="compact"
                              variant="primary"
                              onClick={() => handleApprove(submission)}
                              disabled={isPending}
                            >
                              {t("approve")}
                            </Button>
                          ) : null}
                          <Button
                            size="compact"
                            variant="destructive"
                            onClick={async () => {
                              if (!confirm(t("confirmReject"))) return;
                              startTransition(async () => {
                                setError(null);
                                const result = await rejectSubmissionAction(
                                  submission.id,
                                  "admin_reject",
                                  "",
                                );
                                if (result?.error) {
                                  setError(result.error);
                                  toast.error(result.error);
                                }
                              });
                            }}
                            disabled={isPending}
                            className="min-h-12 px-2 text-xs"
                          >
                            {t("reject")}
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>

                  {expandedId === submission.id && (
                    <TableRow key={`${submission.id}-expanded`}>
                      <TableCell colSpan={11} className="bg-background p-6">
                        <div className="space-y-4">
                          <EnrichedCard auto={hasEnrichment}>
                            <div className="space-y-3">
                              <FieldLabel auto={hasEnrichment}>
                                {t("fields.description")}
                              </FieldLabel>
                              <Textarea
                                value={form.description ?? ""}
                                onChange={(e) =>
                                  updateOverride(
                                    submission.id,
                                    "description",
                                    e.target.value,
                                  )
                                }
                                onClick={(e) => e.stopPropagation()}
                                placeholder={t("placeholders.description")}
                                className={
                                  hasEnrichment
                                    ? "border-dashed bg-white/80"
                                    : undefined
                                }
                              />
                            </div>
                          </EnrichedCard>

                          <EnrichedCard auto={hasEnrichment}>
                            <div className="space-y-3">
                              <FieldLabel auto={hasEnrichment}>
                                {t("fields.productType")}
                              </FieldLabel>
                              <Select
                                value={form.productType || PRODUCT_TYPE_EMPTY}
                                onValueChange={(value) =>
                                  updateOverride(
                                    submission.id,
                                    "productType",
                                    value === PRODUCT_TYPE_EMPTY ? "" : value,
                                  )
                                }
                              >
                                <SelectTrigger
                                  onClick={(e) => e.stopPropagation()}
                                  className={
                                    hasEnrichment
                                      ? "border-dashed bg-white/80"
                                      : undefined
                                  }
                                >
                                  <SelectValue placeholder={t("placeholders.selectProductType")} />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={PRODUCT_TYPE_EMPTY}>
                                    {t("notSet")}
                                  </SelectItem>
                                  {form.productType &&
                                    !PRODUCT_TYPE_CATEGORIES.some(
                                      (c) => c.slug === form.productType,
                                    ) && (
                                      <SelectItem value={form.productType}>
                                        {form.productType}
                                      </SelectItem>
                                    )}
                                  {PRODUCT_TYPE_CATEGORIES.map((category) => (
                                    <SelectItem
                                      key={category.slug}
                                      value={category.slug}
                                    >
                                      {`${category.nameZh} (${category.name})`}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </EnrichedCard>

                          <EnrichedCard auto={hasEnrichment}>
                            <div className="space-y-3">
                              <FieldLabel auto={hasEnrichment}>
                                {t("fields.purchaseLinks")}
                              </FieldLabel>
                              <div className="grid gap-3 sm:grid-cols-3">
                                <Input
                                  type="url"
                                  placeholder={t("placeholders.officialWebsite")}
                                  value={form.purchaseWebsite ?? ""}
                                  onChange={(e) =>
                                    updateOverride(
                                      submission.id,
                                      "purchaseWebsite",
                                      e.target.value,
                                    )
                                  }
                                  onClick={(e) => e.stopPropagation()}
                                  className={
                                    hasEnrichment
                                      ? "border-dashed bg-white/80"
                                      : undefined
                                  }
                                />
                                <Input
                                  type="url"
                                  placeholder={t("placeholders.pinkoiLink")}
                                  value={form.purchasePinkoi ?? ""}
                                  onChange={(e) =>
                                    updateOverride(
                                      submission.id,
                                      "purchasePinkoi",
                                      e.target.value,
                                    )
                                  }
                                  onClick={(e) => e.stopPropagation()}
                                  className={
                                    hasEnrichment
                                      ? "border-dashed bg-white/80"
                                      : undefined
                                  }
                                />
                                <Input
                                  type="url"
                                  placeholder={t("placeholders.shopeeLink")}
                                  value={form.purchaseShopee ?? ""}
                                  onChange={(e) =>
                                    updateOverride(
                                      submission.id,
                                      "purchaseShopee",
                                      e.target.value,
                                    )
                                  }
                                  onClick={(e) => e.stopPropagation()}
                                  className={
                                    hasEnrichment
                                      ? "border-dashed bg-white/80"
                                      : undefined
                                  }
                                />
                              </div>
                              <div className="space-y-2">
                                {form.otherUrls.map((link, index) => (
                                  <div
                                    key={`${index}-${link.label}`}
                                    className="grid gap-2 sm:grid-cols-[160px_1fr_auto]"
                                  >
                                    <Input
                                      placeholder={t("fields.label")}
                                      value={link.label}
                                      onChange={(e) =>
                                        updateOtherUrl(
                                          submission.id,
                                          index,
                                          "label",
                                          e.target.value,
                                        )
                                      }
                                      onClick={(e) => e.stopPropagation()}
                                      className={
                                        hasEnrichment
                                          ? "border-dashed bg-white/80"
                                          : undefined
                                      }
                                    />
                                    <Input
                                      type="url"
                                      placeholder={t("fields.url")}
                                      value={link.url}
                                      onChange={(e) =>
                                        updateOtherUrl(
                                          submission.id,
                                          index,
                                          "url",
                                          e.target.value,
                                        )
                                      }
                                      onClick={(e) => e.stopPropagation()}
                                      className={
                                        hasEnrichment
                                          ? "border-dashed bg-white/80"
                                          : undefined
                                      }
                                    />
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        removeOtherUrl(submission.id, index);
                                      }}
                                    >
                                      {t("fields.remove")}
                                    </Button>
                                  </div>
                                ))}
                                <Button
                                  type="button"
                                  variant="secondary"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    addOtherUrl(submission.id);
                                  }}
                                >
                                  {t("fields.addLink")}
                                </Button>
                              </div>
                            </div>
                          </EnrichedCard>

                          <EnrichedCard auto={hasEnrichment}>
                            <div className="space-y-3">
                              <FieldLabel auto={hasEnrichment}>
                                {t("fields.socialLinks")}
                              </FieldLabel>
                              <div className="grid gap-3 sm:grid-cols-3">
                                <Input
                                  type="url"
                                  placeholder={t("placeholders.instagramLink")}
                                  value={form.socialInstagram ?? ""}
                                  onChange={(e) =>
                                    updateOverride(
                                      submission.id,
                                      "socialInstagram",
                                      e.target.value,
                                    )
                                  }
                                  onClick={(e) => e.stopPropagation()}
                                  className={
                                    hasEnrichment
                                      ? "border-dashed bg-white/80"
                                      : undefined
                                  }
                                />
                                <Input
                                  type="url"
                                  placeholder={t("placeholders.threadsLink")}
                                  value={form.socialThreads ?? ""}
                                  onChange={(e) =>
                                    updateOverride(
                                      submission.id,
                                      "socialThreads",
                                      e.target.value,
                                    )
                                  }
                                  onClick={(e) => e.stopPropagation()}
                                  className={
                                    hasEnrichment
                                      ? "border-dashed bg-white/80"
                                      : undefined
                                  }
                                />
                                <Input
                                  type="url"
                                  placeholder={t("placeholders.facebookLink")}
                                  value={form.socialFacebook ?? ""}
                                  onChange={(e) =>
                                    updateOverride(
                                      submission.id,
                                      "socialFacebook",
                                      e.target.value,
                                    )
                                  }
                                  onClick={(e) => e.stopPropagation()}
                                  className={
                                    hasEnrichment
                                      ? "border-dashed bg-white/80"
                                      : undefined
                                  }
                                />
                              </div>
                            </div>
                          </EnrichedCard>

                          {(() => {
                            const hasImages = Boolean(
                              submission.enriched_data ||
                              submission.heroImageUrl,
                            );

                            return hasImages ? (
                              <EnrichedCard auto>
                                <div className="space-y-3">
                                  <FieldLabel auto>{t("fields.heroImages")}</FieldLabel>
                                  <div className="grid gap-3 sm:grid-cols-4">
                                    {(submission.enriched_data?.heroImageUrl ||
                                      submission.heroImageUrl) && (
                                      <a
                                        href={
                                          submission.enriched_data
                                            ?.heroImageUrl ||
                                          submission.heroImageUrl ||
                                          ""
                                        }
                                        target="_blank"
                                        rel="noreferrer"
                                        className="block overflow-hidden rounded-md border border-dashed bg-white"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                          src={
                                            submission.enriched_data
                                              ?.heroImageUrl ||
                                            submission.heroImageUrl ||
                                            ""
                                          }
                                          alt={`${submission.brandName} hero`}
                                          className="aspect-square w-full object-cover"
                                        />
                                        <span className="block px-2 py-1 type-caption">
                                          {t("fields.mainImage")}
                                        </span>
                                      </a>
                                    )}
                                  </div>
                                  {!submission.heroImageUrl &&
                                    !submission.enriched_data?.heroImageUrl && (
                                      <p className="type-card-description">
                                        {t("fields.noImages")}
                                      </p>
                                    )}
                                </div>
                              </EnrichedCard>
                            ) : null;
                          })()}

                          {submissionIntent === "recommend" &&
                            submission.sourceAttribution && (
                              <div>
                                <p className="type-metadata">
                                  {t("sourceAttribution.question")}
                                </p>
                                <p className="mt-1 text-sm">
                                  {t(`sourceAttribution.${submission.sourceAttribution}` as `sourceAttribution.${SourceAttribution}`)}
                                </p>
                              </div>
                            )}

                          {submissionIntent === "owner_claim" ? (
                            <div className="rounded-lg border border-border bg-card p-4 type-card-description">
                              {t("claimNote")}
                            </div>
                          ) : null}

                          {submission.productTypeNote?.trim() && (
                            <div>
                              <Badge variant="verified">{t("categoryGap")}</Badge>
                              <p className="mt-1 type-card-description">
                                {submission.productTypeNote}
                              </p>
                            </div>
                          )}

                          {(() => {
                            const suggestedTags =
                              submission.suggestedTags as unknown;

                            if (Array.isArray(suggestedTags)) {
                              return (
                                suggestedTags.length > 0 && (
                                  <div>
                                    <p className="type-metadata">{t("suggestedTags")}</p>
                                    <div className="mt-1 flex flex-wrap gap-2">
                                      {suggestedTags.map((tag) => (
                                        <Badge key={tag} variant="secondary">
                                          {tag}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                )
                              );
                            }

                            if (isStructuredSuggestedTags(suggestedTags)) {
                              const { values } =
                                getStructuredSuggestedTagSections(
                                  suggestedTags,
                                );

                              return (
                                values.length > 0 && (
                                  <div>
                                    <p className="type-metadata">{t("suggestedTags")}</p>
                                    <div className="mt-1 space-y-1 text-sm">
                                      {values.length > 0 && (
                                        <p>Values: {values.join(", ")}</p>
                                      )}
                                    </div>
                                  </div>
                                )
                              );
                            }

                            return null;
                          })()}

                          {error && (
                            <p className="text-sm text-destructive">{error}</p>
                          )}
                          {submission.status === "pending" && (
                            <div className="flex items-start gap-3">
                              {readyForReview ? (
                                <Button
                                  variant="primary"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleApprove(submission);
                                  }}
                                  disabled={isPending}
                                >
                                  {t("approve")}
                                </Button>
                              ) : (
                                <p className="flex-1 type-card-description">
                                  {t("approvalRequired")}
                                  {submission.latestCurationError
                                    ? ` ${submission.latestCurationError}`
                                    : ""}
                                </p>
                              )}
                              <div className="flex-1">
                                {rejectingId === submission.id && (
                                  <div className="mb-2 space-y-3">
                                    <div className="space-y-2">
                                      <Label className="type-subsection-title">
                                        {t("rejectReasonLabel")}{" "}
                                        <span className="text-destructive">
                                          *
                                        </span>
                                      </Label>
                                      <Select
                                        value={rejectReason}
                                        onValueChange={(value) =>
                                          setRejectReason(value as DenialReason)
                                        }
                                      >
                                        <SelectTrigger
                                          aria-label={t("rejectReasonAriaLabel")}
                                          onClick={(e) => e.stopPropagation()}
                                          className="h-12 w-full focus-visible:ring-2 focus-visible:ring-primary/60"
                                        >
                                          <SelectValue placeholder={t("selectReason")} />
                                        </SelectTrigger>
                                        <SelectContent align="start">
                                          {DENIAL_REASONS.map((reason) => (
                                            <SelectItem
                                              key={reason}
                                              value={reason}
                                            >
                                              {denialReasonsT(reason)}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <Textarea
                                      placeholder={
                                        rejectReason === "other"
                                          ? t("placeholders.notesRequired")
                                          : t("placeholders.notesOptional")
                                      }
                                      value={rejectNotes}
                                      onChange={(e) =>
                                        setRejectNotes(e.target.value)
                                      }
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  </div>
                                )}
                                <Button
                                  variant="destructive"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleReject(submission.id);
                                  }}
                                  disabled={
                                    isPending ||
                                    (rejectingId === submission.id &&
                                      !rejectReason)
                                  }
                                >
                                  {rejectingId === submission.id
                                    ? t("confirmRejectButton")
                                    : t("reject")}
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={11}
                  className="py-8 text-center text-muted-foreground"
                >
                  {t("notFound")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
