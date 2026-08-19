"use client";

import { Fragment, useState, useTransition } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MailCheck,
  MoreHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import type { BrandStatus } from "@/lib/types";
import type { AdminBrandListItem } from "@/lib/brands/contracts";
import type { SubmissionReviewImage } from "@/lib/services/submissions";
import { surfaceCardStyles } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { BrandStatusBadge } from "./status-badge";
import { BrandEditDetails } from "./brand-edit-details";
import {
  BrandDetailSheet,
  isInteractiveTableTarget,
} from "./brand-detail-sheet";
import { ConfirmDialog } from "./confirm-dialog";
import {
  hideBrandAction,
  unhideBrandAction,
  deleteBrandAction,
  requestBrandRefreshAction,
  requestCuratedProductBackfillAction,
  resendClaimInviteAction,
} from "@/app/admin/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { statusStyles, textStyles } from "@/components/ui/text-styles";
import { MAX_BULK_PRODUCT_BACKFILL } from "@/lib/constants/curated-products";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/utils";

type TabValue = "all" | BrandStatus;
type MitStatus = NonNullable<AdminBrandListItem["mitStatus"]>;
const PAGE_SIZES = [10, 25, 50] as const;

const MIT_STATUS_CONFIG: Record<
  MitStatus,
  { label: string; className: string }
> = {
  unverified: {
    label: "MIT Unverified",
    className: "bg-secondary text-muted-foreground",
  },
  declared: {
    label: "品牌聲明",
    className: "bg-secondary text-muted-foreground",
  },
  verified: {
    label: "MIT Smile Certified",
    className: "bg-verified-green-bg text-verified-green",
  },
};

function getMitStatus(brand: AdminBrandListItem): MitStatus {
  if (brand.mitStatus) return brand.mitStatus;
  return brand.mitVerified ? "verified" : "unverified";
}

/**
 * `request_brand_refresh` accepts approved and hidden brands only (it raises on
 * anything else), so an ineligible brand is unselectable rather than one row of
 * a batch failing after the admin has already clicked.
 */
function canGenerateProducts(brand: AdminBrandListItem): boolean {
  return brand.status === "approved" || brand.status === "hidden";
}

function MitStatusBadge({ status }: { status: MitStatus }) {
  const config = MIT_STATUS_CONFIG[status];

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 type-metadata",
        config.className,
      )}
    >
      {config.label}
    </span>
  );
}

export function BrandList({
  brands,
  reviewImagesByBrandId = {},
  claimInviteBrandIds = [],
  initialEditingBrandId,
  initialSearchQuery = "",
  initialTab = "all",
}: {
  brands: AdminBrandListItem[];
  reviewImagesByBrandId?: Record<string, SubmissionReviewImage[]>;
  claimInviteBrandIds?: string[];
  initialEditingBrandId?: string;
  initialSearchQuery?: string;
  initialTab?: TabValue;
}) {
  const [activeTab, setActiveTab] = useState<TabValue>(initialTab);
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [mitFilter, setMitFilter] = useState<"all" | MitStatus>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(10);
  // Brands are tracked by id, never as a snapshot object: the parent server
  // component re-sends `brands` after router.refresh(), and a captured object
  // would keep rendering (and re-saving) pre-edit values.
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(
    initialEditingBrandId ?? null,
  );
  const [deletingBrandId, setDeletingBrandId] = useState<string | null>(null);
  const [refreshingBrandId, setRefreshingBrandId] = useState<string | null>(
    null,
  );
  // Ids, never brand objects, for the same reason as `selectedBrandId` above:
  // the server re-sends `brands` after a revalidate, and a captured object would
  // queue work against pre-edit values.
  const [productBackfillIds, setProductBackfillIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [productBackfillStatus, setProductBackfillStatus] = useState<
    string | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const claimInviteBrandIdSet = new Set(claimInviteBrandIds);

  const brandsById = new Map(brands.map((brand) => [brand.id, brand]));

  // A brand can leave `brands` entirely (deleted, or dropped by the server
  // query). The derived lookups below already close the sheet and dialogs in
  // that case, so this is purely a *reopen* guard: without it the id would
  // linger and the sheet would silently spring back open if a later refresh
  // returned the brand. Adjusting state during render is React's sanctioned
  // pattern for reacting to a prop change (an effect here trips
  // react-hooks/set-state-in-effect and costs an extra commit).
  const [prevBrands, setPrevBrands] = useState(brands);
  if (prevBrands !== brands) {
    setPrevBrands(brands);
    if (selectedBrandId && !brandsById.has(selectedBrandId)) {
      setSelectedBrandId(null);
    }
    if (deletingBrandId && !brandsById.has(deletingBrandId)) {
      setDeletingBrandId(null);
    }
    if (refreshingBrandId && !brandsById.has(refreshingBrandId)) {
      setRefreshingBrandId(null);
    }
    // A queued selection must not outlive the rows it names, or the action would
    // post ids the server no longer lists. One pass: the filtered set answers
    // both "did anything drop?" and "what is left?".
    const stillListed = [...productBackfillIds].filter((brandId) =>
      brandsById.has(brandId),
    );
    if (stillListed.length !== productBackfillIds.size) {
      setProductBackfillIds(new Set(stillListed));
    }
  }

  const selectedBrand =
    (selectedBrandId ? brandsById.get(selectedBrandId) : null) ?? null;
  const deletingBrand =
    (deletingBrandId ? brandsById.get(deletingBrandId) : null) ?? null;
  const refreshingBrand =
    (refreshingBrandId ? brandsById.get(refreshingBrandId) : null) ?? null;

  const categories = Array.from(
    new Set(brands.map((b) => b.categoryLabel).filter(Boolean) as string[]),
  ).sort();

  const filtered = brands
    .filter((b) => activeTab === "all" || b.status === activeTab)
    .filter(
      (b) =>
        !searchQuery ||
        b.name.toLowerCase().includes(searchQuery.toLowerCase()),
    )
    .filter((b) => mitFilter === "all" || getMitStatus(b) === mitFilter)
    .filter((b) => categoryFilter === "all" || b.categoryLabel === categoryFilter);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  // Page-scoped, like the header checkbox it feeds: "select all" must never
  // reach rows the admin cannot see.
  const selectableVisible = visible.filter(canGenerateProducts);
  // Declared once and reused by the header checkbox AND by the toggle it
  // drives. The two used to compute the same predicate separately, which is one
  // edit away from a header that says "all selected" while the toggle adds.
  const everySelectableVisibleSelected = (selection: Set<string>): boolean =>
    selectableVisible.every((brand) => selection.has(brand.id));
  const allVisibleSelected =
    selectableVisible.length > 0 &&
    everySelectableVisibleSelected(productBackfillIds);
  const someVisibleSelected =
    !allVisibleSelected &&
    selectableVisible.some((brand) => productBackfillIds.has(brand.id));
  // The cap is enforced in the server action too — this is what stops the admin
  // reaching it blind. Past the limit every UNSELECTED checkbox is disabled, so
  // a selection can only shrink, and the bulk bar names the number.
  const selectionAtCap = productBackfillIds.size >= MAX_BULK_PRODUCT_BACKFILL;

  function handleHide(brand: AdminBrandListItem) {
    startTransition(async () => {
      setError(null);
      const result = await hideBrandAction(brand.id);
      if (result?.error) setError(result.error);
    });
  }

  function handleUnhide(brand: AdminBrandListItem) {
    startTransition(async () => {
      setError(null);
      const result = await unhideBrandAction(brand.id);
      if (result?.error) setError(result.error);
    });
  }

  function handleDelete() {
    if (!deletingBrand) return;
    startTransition(async () => {
      setError(null);
      const result = await deleteBrandAction(deletingBrand.id);
      if (result?.error) setError(result.error);
      else setDeletingBrandId(null);
    });
  }

  function handleResendClaimInvite(brand: AdminBrandListItem) {
    startTransition(async () => {
      const result = await resendClaimInviteAction(brand.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Claim invitation sent");
    });
  }

  function toggleProductBackfill(brandId: string) {
    setProductBackfillIds((current) => {
      const next = new Set(current);
      if (next.has(brandId)) next.delete(brandId);
      else if (next.size < MAX_BULK_PRODUCT_BACKFILL) next.add(brandId);
      return next;
    });
  }

  function toggleProductBackfillPage() {
    setProductBackfillIds((current) => {
      const next = new Set(current);
      if (everySelectableVisibleSelected(current)) {
        for (const brand of selectableVisible) next.delete(brand.id);
        return next;
      }
      // Fills to the cap and stops, rather than refusing the whole page: the
      // page the admin is looking at is the selection they asked for, and a
      // silent no-op would read as a broken checkbox.
      for (const brand of selectableVisible) {
        if (next.size >= MAX_BULK_PRODUCT_BACKFILL) break;
        next.add(brand.id);
      }
      return next;
    });
  }

  function handleGenerateProducts() {
    const brandIds = [...productBackfillIds];
    if (brandIds.length === 0) return;
    startTransition(async () => {
      setError(null);
      setProductBackfillStatus(null);
      const result = await requestCuratedProductBackfillAction(brandIds);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      const queued = result.outcomes.filter(
        (outcome) => outcome.submissionId !== null,
      ).length;
      // "A refresh is already pending" is an ordinary answer, not a failure, so
      // it is reported in the same status line as the successes.
      const skipped = result.outcomes.filter((outcome) => outcome.error !== null);
      setProductBackfillStatus(
        [
          queued > 0
            ? `Queued product generation for ${queued} ${
                queued === 1 ? "brand" : "brands"
              }. It runs on the next worker pass.`
            : "No brand was queued.",
          ...skipped.map(
            (outcome) =>
              `${brandsById.get(outcome.brandId)?.name ?? outcome.brandId}: ${
                outcome.error
              }`,
          ),
        ].join(" "),
      );
      setProductBackfillIds(new Set());
    });
  }

  function handleRequestRefresh() {
    if (!refreshingBrand) return;
    startTransition(async () => {
      setError(null);
      const result = await requestBrandRefreshAction(refreshingBrand.id);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      toast.success("Re-enrichment requested for the next scheduled run");
      setRefreshingBrandId(null);
    });
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  return (
    <div>
      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          setActiveTab(v as TabValue);
          setPage(1);
        }}
      >
        <TabsList>
          <TabsTrigger value="all">All ({brands.length})</TabsTrigger>
          <TabsTrigger value="approved">
            Live ({brands.filter((b) => b.status === "approved").length})
          </TabsTrigger>
          <TabsTrigger value="hidden">
            Hidden ({brands.filter((b) => b.status === "hidden").length})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {error && <p className="mt-2 type-body-sm text-destructive">{error}</p>}

      {/*
        A status, not an alert: "a refresh is already pending" is an ordinary
        answer to the request, and interrupting the admin for it would be wrong.
        Rendered unconditionally so the live region exists BEFORE it has text —
        a region added at the same moment as its content is not announced.
      */}
      <p
        role="status"
        className={cn(
          "type-body-sm text-muted-foreground",
          productBackfillStatus && "mt-2",
        )}
      >
        {productBackfillStatus}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search brand name..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setPage(1);
          }}
          className="w-56"
        />
        <NativeSelect
          value={mitFilter}
          onChange={(e) => {
            setMitFilter(e.target.value as typeof mitFilter);
            setPage(1);
          }}
          className="w-fit"
        >
          <option value="all">All MIT status</option>
          <option value="unverified">MIT Unverified</option>
          <option value="verified">MIT Smile Certified</option>
        </NativeSelect>
        <NativeSelect
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            setPage(1);
          }}
          className="w-fit"
        >
          <option value="all">All categories</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </NativeSelect>
      </div>

      {/*
        Shown only once something is selected, like the review queue's bulk bar.
        The label names its exact scope and its count — "Refresh" would not say
        what runs, and a curated-product run is neither free nor instant. The
        cost and the queue behaviour ride the accessible name rather than a
        confirm dialog nobody would read twice.
      */}
      {productBackfillIds.size > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            disabled={isPending}
            aria-label={`Generate products for ${productBackfillIds.size} selected ${
              productBackfillIds.size === 1 ? "brand" : "brands"
            }, of ${MAX_BULK_PRODUCT_BACKFILL} per run — opens a refresh per brand and queues one enrichment job that calls the model`}
            onClick={handleGenerateProducts}
          >
            {`Generate products for ${productBackfillIds.size} selected ${
              productBackfillIds.size === 1 ? "brand" : "brands"
            }`}
          </Button>
          {/*
            The count against the limit, shown as plain text rather than only in
            the accessible name: the bound is the one thing a growing selection
            has to be able to see coming.
          */}
          <span className="type-body-sm">
            {`${productBackfillIds.size} of ${MAX_BULK_PRODUCT_BACKFILL} per run${
              selectionAtCap ? " — limit reached" : ""
            }`}
          </span>
          <Button
            type="button"
            variant="ghost"
            disabled={isPending}
            onClick={() => setProductBackfillIds(new Set())}
          >
            Clear selection
          </Button>
        </div>
      )}

      <div
        className={surfaceCardStyles({
          className: "mt-4 overflow-hidden",
          padding: "none",
        })}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">
                <Label className="flex min-h-12 min-w-12 cursor-pointer items-center">
                  <Checkbox
                    aria-label={`Select every eligible brand on this page for product generation, up to ${MAX_BULK_PRODUCT_BACKFILL} brands per run`}
                    checked={allVisibleSelected}
                    indeterminate={someVisibleSelected}
                    disabled={
                      selectableVisible.length === 0 ||
                      (selectionAtCap && !allVisibleSelected)
                    }
                    onCheckedChange={() => toggleProductBackfillPage()}
                  />
                </Label>
              </TableHead>
              <TableHead>Brand</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>MIT</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last updated at</TableHead>
              <TableHead className="min-w-[300px] text-right">
                Actions
              </TableHead>
              <TableHead className="w-12">
                <span className="sr-only">Details</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((brand) => (
              <Fragment key={brand.id}>
                <TableRow
                  className="cursor-pointer hover:bg-secondary"
                  data-state={
                    productBackfillIds.has(brand.id) ? "selected" : undefined
                  }
                  onClick={(event) => {
                    if (isInteractiveTableTarget(event.target)) return;
                    // The checkbox's own 48px hit area is a <label>, and its
                    // padding is not an interactive element — without this, half
                    // of every tick would also open the detail sheet.
                    if (
                      event.target instanceof Element &&
                      event.target.closest("label")
                    )
                      return;
                    setSelectedBrandId(brand.id);
                  }}
                >
                  <TableCell>
                    <Label className="flex min-h-12 min-w-12 cursor-pointer items-center">
                      <Checkbox
                        aria-label={
                          selectionAtCap && !productBackfillIds.has(brand.id)
                            ? `Cannot select ${brand.name}: product generation runs at most ${MAX_BULK_PRODUCT_BACKFILL} brands per run`
                            : `Select ${brand.name} for product generation`
                        }
                        checked={productBackfillIds.has(brand.id)}
                        disabled={
                          !canGenerateProducts(brand) ||
                          (selectionAtCap && !productBackfillIds.has(brand.id))
                        }
                        onCheckedChange={() => toggleProductBackfill(brand.id)}
                      />
                    </Label>
                  </TableCell>
                  <TableCell className="max-w-[180px] font-medium">
                    <span className="block truncate">{brand.name}</span>
                    {brand.isDemo && (
                      <span
                        className={cn(
                          "ml-1.5 inline-flex items-center rounded-full px-2 py-0.5",
                          textStyles({ variant: "micro" }),
                          statusStyles.demoBadge,
                        )}
                      >
                        Demo
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <BrandStatusBadge status={brand.status} />
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <MitStatusBadge status={getMitStatus(brand)} />
                      {brand.mitEvidence?.mit_smile_cert && (
                        <p className="type-metadata">
                          Cert: {brand.mitEvidence.mit_smile_cert}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{brand.categoryLabel ?? "-"}</TableCell>
                  <TableCell>{formatDate(brand.createdAt)}</TableCell>
                  <TableCell>{formatDate(brand.updatedAt)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Link
                        href={`/${routing.defaultLocale}/dashboard/brands/${brand.slug}`}
                        className={buttonVariants({
                          variant: "secondary",
                          size: "compact",
                        })}
                      >
                        View in Dashboard
                      </Link>
                      {claimInviteBrandIdSet.has(brand.id) && (
                        <Button
                          variant="secondary"
                          size="compact"
                          onClick={() => handleResendClaimInvite(brand)}
                          disabled={isPending}
                        >
                          <MailCheck className="size-4" aria-hidden />
                          Resend claim invite
                        </Button>
                      )}
                      {brand.status === "approved" && (
                        <Button
                          variant="secondary"
                          size="compact"
                          onClick={() => handleHide(brand)}
                          disabled={isPending}
                        >
                          Hide
                        </Button>
                      )}
                      {brand.status === "hidden" && (
                        <Button
                          variant="secondary"
                          size="compact"
                          onClick={() => handleUnhide(brand)}
                          disabled={isPending}
                        >
                          Unhide
                        </Button>
                      )}
                      {(brand.status === "approved" ||
                        brand.status === "hidden") && (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            aria-label={`Open brand actions for ${brand.name}`}
                            className={buttonVariants({
                              variant: "ghost",
                              size: "icon",
                              shape: "pill",
                            })}
                          >
                            <MoreHorizontal className="size-4" aria-hidden />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="w-40 min-w-40 rounded-lg border border-border bg-card shadow-card-hover"
                          >
                            <DropdownMenuItem
                              disabled={isPending}
                              className="text-foreground hover:bg-muted focus:bg-muted"
                              onClick={() => setRefreshingBrandId(brand.id)}
                            >
                              Request re-enrichment
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                      {(brand.status === "approved" ||
                        brand.status === "hidden") && (
                        <Link
                          href={`/admin/curated-products?brand=${brand.slug}`}
                          aria-label={`Ingest curated products for ${brand.name}`}
                          className={buttonVariants({
                            variant: "secondary",
                            size: "compact",
                          })}
                        >
                          Curated products
                        </Link>
                      )}
                      <Button
                        variant="secondary"
                        size="compact"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeletingBrandId(brand.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      shape="pill"
                      variant="ghost"
                      className="h-12 w-12 p-0"
                      onClick={() => setSelectedBrandId(brand.id)}
                      aria-expanded={selectedBrand?.id === brand.id}
                      aria-controls={`brand-detail-${brand.id}`}
                      aria-label={`Open details for ${brand.name}`}
                    >
                      <ChevronDown
                        className={`size-4 transition-transform ${
                          selectedBrand?.id === brand.id ? "rotate-180" : ""
                        }`}
                        aria-hidden="true"
                      />
                    </Button>
                  </TableCell>
                </TableRow>
              </Fragment>
            ))}
            {visible.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="py-8 text-center text-muted-foreground"
                >
                  No brands found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="type-body-sm">
          Showing {filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}
          –{Math.min(currentPage * pageSize, filtered.length)} of{" "}
          {filtered.length} brands
        </p>
        <div className="flex items-center gap-2">
          <NativeSelect
            aria-label="Brands per page"
            value={pageSize}
            onChange={(event) => {
              setPageSize(
                Number(event.target.value) as (typeof PAGE_SIZES)[number],
              );
              setPage(1);
            }}
            className="h-12 w-auto"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} per page
              </option>
            ))}
          </NativeSelect>
          <Button
            shape="pill"
            variant="secondary"
            className="h-12 w-12 p-0"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={currentPage === 1}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <span className="min-w-16 text-center type-body-sm">
            {currentPage} / {pageCount}
          </span>
          <Button
            shape="pill"
            variant="secondary"
            className="h-12 w-12 p-0"
            onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
            disabled={currentPage === pageCount}
            aria-label="Next page"
          >
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      <BrandDetailSheet
        open={selectedBrand !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedBrandId(null);
        }}
        title={selectedBrand?.name ?? ""}
        metadata={
          selectedBrand ? (
            <p className="type-metadata">
              Created {formatDate(selectedBrand.createdAt)}
            </p>
          ) : null
        }
      >
        {selectedBrand && (
          <BrandEditDetails
            key={selectedBrand.id}
            brand={selectedBrand}
            reviewImages={reviewImagesByBrandId[selectedBrand.id] ?? []}
          />
        )}
      </BrandDetailSheet>

      <ConfirmDialog
        open={refreshingBrand !== null}
        onOpenChange={(open) => {
          if (!open) setRefreshingBrandId(null);
        }}
        title="Request re-enrichment"
        description="A refresh will run on the next six-hour schedule and return to the submissions queue for review. The live brand will not change until the refresh is applied."
        onConfirm={handleRequestRefresh}
        confirmLabel="Request re-enrichment"
        isPending={isPending}
      />

      <ConfirmDialog
        open={deletingBrand !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingBrandId(null);
        }}
        title="Delete brand"
        description="This action cannot be undone. The brand and all associated data will be permanently deleted."
        onConfirm={handleDelete}
        confirmLabel="Delete"
        variant="destructive"
        confirmText={deletingBrand?.name}
        isPending={isPending}
      />
    </div>
  );
}
