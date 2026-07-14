"use client";

import { Fragment, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
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
} from "@/app/admin/actions";
import { startCurationJobAction } from "@/app/admin/operations/actions";
import type { CurationJobParams } from "@/lib/services/curation-jobs";
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
type CurationOperation = "enrich";

const CURATION_ACTIONS: Array<{
  label: string;
  operation: CurationOperation;
  phases?: CurationJobParams["phases"];
}> = [
  { label: "Enrich Brand", operation: "enrich" },
  { label: "Enrich Links", operation: "enrich", phases: ["discover", "links"] },
  { label: "Enrich Images", operation: "enrich", phases: ["images"] },
];

const MIT_STATUS_CONFIG: Record<
  MitStatus,
  { label: string; className: string }
> = {
  unverified: {
    label: "MIT 未驗證",
    className: "bg-secondary text-muted-foreground",
  },
  verified: {
    label: "MIT 微笑認證",
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

export function BrandList({ brands }: { brands: Brand[] }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabValue>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [mitFilter, setMitFilter] = useState<"all" | MitStatus>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null);
  const [deletingBrand, setDeletingBrand] = useState<Brand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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

  function handleStartCurationJob(
    brand: Brand,
    operation: CurationOperation,
    phases?: CurationJobParams["phases"],
  ) {
    startTransition(async () => {
      setError(null);
      const params: CurationJobParams = { slugs: [brand.slug] };

      if (phases) {
        params.phases = phases;
      }

      const result = await startCurationJobAction(operation, params, false);

      if ("error" in result) {
        setError(result.error);
        return;
      }

      if ("queued" in result) {
        const notify =
          result.dispatchStatus === "failed" ? toast.error : toast.info;
        notify(result.message, {
          action: {
            label: "查看工作",
            onClick: () => router.push(result.detailPath),
          },
        });
        return;
      }
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
        onValueChange={(v) => setActiveTab(v as TabValue)}
      >
        <TabsList>
          <TabsTrigger value="all">全部 ({brands.length})</TabsTrigger>
          <TabsTrigger value="approved">
            已上架 ({brands.filter((b) => b.status === "approved").length})
          </TabsTrigger>
          <TabsTrigger value="hidden">
            已隱藏 ({brands.filter((b) => b.status === "hidden").length})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Input
          placeholder="搜尋品牌名稱..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-8 w-56 text-sm"
        />
        <NativeSelect
          value={mitFilter}
          onChange={(e) => setMitFilter(e.target.value as typeof mitFilter)}
          className="h-8 w-fit"
        >
          <option value="all">全部 MIT 狀態</option>
          <option value="unverified">MIT 未驗證</option>
          <option value="verified">MIT 微笑認證</option>
        </NativeSelect>
        <NativeSelect
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="h-8 w-fit"
        >
          <option value="all">全部分類</option>
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
              <TableHead>品牌</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead>MIT</TableHead>
              <TableHead>分類</TableHead>
              <TableHead>建立日期</TableHead>
              <TableHead className="min-w-[300px] text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((brand) => (
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
                        編輯
                      </Button>
                      <Link
                        href={`/${routing.defaultLocale}/dashboard/brands/${brand.slug}`}
                        className={buttonVariants({
                          variant: "secondary",
                          size: "compact",
                        })}
                      >
                        在 Dashboard 查看
                      </Link>
                      {brand.status === "approved" && (
                        <Button
                          variant="secondary"
                          size="compact"
                          onClick={() => handleHide(brand)}
                          disabled={isPending}
                        >
                          隱藏
                        </Button>
                      )}
                      {brand.status === "hidden" && (
                        <Button
                          variant="secondary"
                          size="compact"
                          onClick={() => handleUnhide(brand)}
                          disabled={isPending}
                        >
                          取消隱藏
                        </Button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          aria-label={`Open curation actions for ${brand.name}`}
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
                          {CURATION_ACTIONS.map((action) => (
                            <DropdownMenuItem
                              key={action.label}
                              disabled={isPending}
                              className="text-foreground hover:bg-muted focus:bg-muted"
                              onClick={() =>
                                handleStartCurationJob(
                                  brand,
                                  action.operation,
                                  action.phases,
                                )
                              }
                            >
                              {action.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                        variant="secondary"
                        size="compact"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeletingBrand(brand)}
                      >
                        刪除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              </Fragment>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-8 text-center text-muted-foreground"
                >
                  找不到品牌。
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
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
        open={deletingBrand !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingBrand(null);
        }}
        title="刪除品牌"
        description="此操作無法撤銷。品牌及其所有關聯資料將被永久刪除。"
        onConfirm={handleDelete}
        confirmLabel="刪除"
        variant="destructive"
        confirmText={deletingBrand?.name}
        isPending={isPending}
      />
    </div>
  );
}
