"use client";

import { Fragment, useState, useTransition } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  MailCheck,
  MoreHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import type { Brand, BrandStatus } from "@/lib/types";
import { surfaceCardStyles } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { BrandStatusBadge } from "./status-badge";
import { BrandEditDialog } from "./brand-edit-dialog";
import { ConfirmDialog } from "./confirm-dialog";
import {
  hideBrandAction,
  unhideBrandAction,
  deleteBrandAction,
  requestBrandRefreshAction,
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
import { Input } from "@/components/ui/input";
import { statusStyles, textStyles } from "@/components/ui/text-styles";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/utils";

type TabValue = "all" | BrandStatus;
type MitStatus = NonNullable<Brand["mitStatus"]>;
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

function getMitStatus(brand: Brand): MitStatus {
  if (brand.mitStatus) return brand.mitStatus;
  return brand.mitVerified ? "verified" : "unverified";
}

function MitStatusBadge({ status }: { status: MitStatus }) {
  const config = MIT_STATUS_CONFIG[status];

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 type-field-label",
        config.className,
      )}
    >
      {config.label}
    </span>
  );
}

export function BrandList({
  brands,
  claimInviteBrandIds = [],
}: {
  brands: Brand[];
  claimInviteBrandIds?: string[];
}) {
  const [activeTab, setActiveTab] = useState<TabValue>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [mitFilter, setMitFilter] = useState<"all" | MitStatus>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(10);
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null);
  const [deletingBrand, setDeletingBrand] = useState<Brand | null>(null);
  const [refreshingBrand, setRefreshingBrand] = useState<Brand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const claimInviteBrandIdSet = new Set(claimInviteBrandIds);

  const categories = Array.from(
    new Set(brands.map((b) => b.category).filter(Boolean) as string[]),
  ).sort();

  const filtered = brands
    .filter((b) => activeTab === "all" || b.status === activeTab)
    .filter(
      (b) =>
        !searchQuery ||
        b.name.toLowerCase().includes(searchQuery.toLowerCase()),
    )
    .filter((b) => mitFilter === "all" || getMitStatus(b) === mitFilter)
    .filter((b) => categoryFilter === "all" || b.category === categoryFilter);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  function handleHide(brand: Brand) {
    startTransition(async () => {
      setError(null);
      const result = await hideBrandAction(brand.id);
      if (result?.error) setError(result.error);
    });
  }

  function handleUnhide(brand: Brand) {
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
      else setDeletingBrand(null);
    });
  }

  function handleResendClaimInvite(brand: Brand) {
    startTransition(async () => {
      const result = await resendClaimInviteAction(brand.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Claim invitation sent");
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
      setRefreshingBrand(null);
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

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

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

      <div
        className={surfaceCardStyles({
          className: "mt-4 overflow-hidden",
          padding: "none",
        })}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Brand</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>MIT</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="min-w-[300px] text-right">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((brand) => (
              <Fragment key={brand.id}>
                <TableRow>
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
                        <p className="type-caption">
                          Cert: {brand.mitEvidence.mit_smile_cert}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{brand.category ?? "-"}</TableCell>
                  <TableCell>{formatDate(brand.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        variant="secondary"
                        size="compact"
                        onClick={() => setEditingBrand(brand)}
                      >
                        Edit
                      </Button>
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
                              onClick={() => setRefreshingBrand(brand)}
                            >
                              Request re-enrichment
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                      <Button
                        variant="secondary"
                        size="compact"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeletingBrand(brand)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              </Fragment>
            ))}
            {visible.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
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
        <p className="type-card-description">
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
          <span className="min-w-16 text-center type-card-description">
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

      <BrandEditDialog
        key={editingBrand?.id ?? "none"}
        brand={editingBrand}
        open={editingBrand !== null}
        onOpenChange={(open) => {
          if (!open) setEditingBrand(null);
        }}
      />

      <ConfirmDialog
        open={refreshingBrand !== null}
        onOpenChange={(open) => {
          if (!open) setRefreshingBrand(null);
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
          if (!open) setDeletingBrand(null);
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
