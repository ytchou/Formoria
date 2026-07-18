import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { NewsletterSubscribersList } from "@/components/admin/newsletter-subscribers";
import { Button, buttonVariants } from "@/components/ui/button";
import { DataCard } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { createServiceClient } from "@/lib/supabase/server";
import {
  getAdminNewsletterSubscribers,
  getSubscriberStats,
  parseAdminNewsletterFilters,
  VALID_INTERESTS,
} from "@/lib/services/newsletter";

export const metadata: Metadata = { title: "Newsletter | Admin" };
export const revalidate = 0;

export default async function AdminNewsletterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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
        <h1 className="type-section-title-large">Newsletter</h1>
        <p className="type-error">{error instanceof Error ? error.message : "Newsletter data is unavailable"}</p>
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
            <h1 className="type-section-title-large">Newsletter</h1>
            <p className="mt-1 type-card-description">Manage consented subscribers without exposing email action tokens.</p>
          </div>
          <a
            href={`/admin/newsletter/export${exportParams.size ? `?${exportParams}` : ""}`}
            className={buttonVariants({ variant: "secondary", size: "large", className: "min-h-12" })}
          >
            <Download aria-hidden="true" />
            Export CSV
          </a>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <DataCard label="Total" value={stats.total} description="All consent records" />
          <DataCard label="Active" value={stats.active} description="Confirmed and subscribed" />
          <DataCard label="Pending" value={stats.pending} description="Awaiting confirmation" />
          <DataCard label="Unsubscribed" value={stats.unsubscribed} description="Opted-out records" />
          <DataCard label="Confirmation rate" value={`${stats.confirmationRate}%`} description="Active ÷ active plus pending" />
        </div>

        <form className="grid gap-3 rounded-xl border border-border bg-card p-4 lg:grid-cols-[minmax(260px,1fr)_220px_220px_auto] lg:items-end">
          <Label className="space-y-1 type-body-emphasis">
            Search
            <Input name="q" defaultValue={filters.q ?? ""} placeholder="Email or name" />
          </Label>
          <Label className="space-y-1 type-body-emphasis">
            Status
            <NativeSelect name="status" defaultValue={filters.status ?? ""}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="unsubscribed">Unsubscribed</option>
            </NativeSelect>
          </Label>
          <Label className="space-y-1 type-body-emphasis">
            Interest
            <NativeSelect name="interest" defaultValue={filters.interest ?? ""}>
              <option value="">All interests</option>
              {VALID_INTERESTS.map((interest) => <option key={interest} value={interest}>{interest}</option>)}
            </NativeSelect>
          </Label>
          <Button type="submit" variant="secondary" className="min-h-12">Apply filters</Button>
        </form>

        <NewsletterSubscribersList subscribers={page.subscribers} />
        {(page.previousCursor || page.nextCursor) ? (
          <nav aria-label="Newsletter pagination" className="flex justify-between gap-3">
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
  return <Link href={`/admin/newsletter?${query}`} className={buttonVariants({ variant: "secondary", className: "min-h-12" })}>{label}</Link>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
