import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { NewsletterSubscribersList } from "@/components/admin/newsletter-subscribers";
import { Button, buttonVariants } from "@/components/ui/button";
import { DataCard } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { createServiceClient } from "@/lib/supabase/service";
import {
  getAdminNewsletterSubscribers,
  getSubscriberStats,
  parseAdminNewsletterFilters,
  VALID_INTERESTS,
} from "@/lib/services/newsletter";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Newsletter | Admin" };
export const revalidate = 0;

export default async function AdminNewsletterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("admin.newsletter");
  const params = await searchParams;
  const filters = parseAdminNewsletterFilters({
    q: first(params.q),
    status: first(params.status),
    interest: first(params.interest),
    cursor: first(params.cursor),
    direction: first(params.direction),
  });
  const supabase = createServiceClient();

  let page;
  let stats;
  try {
    [page, stats] = await Promise.all([
      getAdminNewsletterSubscribers(supabase, filters),
      getSubscriberStats(supabase),
    ]);
  } catch (error) {
    return (
      <div className="space-y-3">
        <h1 className="type-tool-heading">{t("title")}</h1>
        <p className="type-metadata text-danger">{error instanceof Error ? error.message : t("unavailable")}</p>
      </div>
    );
  }
  const exportParams = new URLSearchParams();
  if (filters.q) exportParams.set("q", filters.q);
  if (filters.status) exportParams.set("status", filters.status);
  if (filters.interest) exportParams.set("interest", filters.interest);

  return (
      <div className="space-y-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="type-tool-heading">{t("title")}</h1>
            <p className="mt-1 type-body-sm">{t("description")}</p>
          </div>
          <a
            href={`${routes.admin.newsletterExport()}${exportParams.size ? `?${exportParams}` : ""}`}
            className={buttonVariants({ variant: "secondary", size: "large" })}
          >
            <Download aria-hidden="true" />
            {t("exportCsv")}
          </a>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <DataCard label="Total" value={stats.total} description={t("stats.totalDescription")} />
          <DataCard label="Active" value={stats.active} description={t("stats.activeDescription")} />
          <DataCard label="Pending" value={stats.pending} description={t("stats.pendingDescription")} />
          <DataCard label="Unsubscribed" value={stats.unsubscribed} description={t("stats.unsubscribedDescription")} />
          <DataCard label="Confirmation rate" value={`${stats.confirmationRate}%`} description={t("stats.confirmationRateDescription")} />
        </div>

        <form className="grid gap-3 rounded-surface border border-rule bg-surface p-4 lg:grid-cols-[minmax(260px,1fr)_220px_220px_auto] lg:items-end">
          <Label className="space-y-1 type-body-sm font-medium text-ink">
            {t("filters.search")}
            <Input name="q" defaultValue={filters.q ?? ""} placeholder={t("filters.searchPlaceholder")} />
          </Label>
          <Label className="space-y-1 type-body-sm font-medium text-ink">
            {t("filters.status")}
            <NativeSelect name="status" defaultValue={filters.status ?? ""}>
              <option value="">{t("filters.allStatuses")}</option>
              <option value="active">{t("filters.active")}</option>
              <option value="pending">{t("filters.pending")}</option>
              <option value="unsubscribed">{t("filters.unsubscribed")}</option>
            </NativeSelect>
          </Label>
          <Label className="space-y-1 type-body-sm font-medium text-ink">
            {t("filters.interest")}
            <NativeSelect name="interest" defaultValue={filters.interest ?? ""}>
              <option value="">{t("filters.allInterests")}</option>
              {VALID_INTERESTS.map((interest) => <option key={interest} value={interest}>{interest}</option>)}
            </NativeSelect>
          </Label>
          <Button type="submit" variant="secondary" size="large">{t("filters.apply")}</Button>
        </form>

        <NewsletterSubscribersList subscribers={page.subscribers} />
        {(page.previousCursor || page.nextCursor) ? (
          <nav aria-label={t("pagination")} className="flex justify-between gap-3">
            <PaginationLink label="Newer" cursor={page.previousCursor} direction="previous" filters={filters} />
            <PaginationLink label="Older" cursor={page.nextCursor} direction="next" filters={filters} />
          </nav>
        ) : null}
      </div>
  );
}

function PaginationLink({ label, cursor, direction, filters }: {
  label: string;
  cursor: string | null;
  direction: "next" | "previous";
  filters: ReturnType<typeof parseAdminNewsletterFilters>;
}) {
  if (!cursor) return <span />;
  const query = new URLSearchParams({ cursor, direction });
  if (filters.q) query.set("q", filters.q);
  if (filters.status) query.set("status", filters.status);
  if (filters.interest) query.set("interest", filters.interest);
  return <Link href={`${routes.admin.newsletter()}?${query}`} className={buttonVariants({ variant: "secondary", size: "large" })}>{label}</Link>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
