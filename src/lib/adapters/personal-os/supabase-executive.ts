import { listCurationJobs } from "@/lib/services/curation-jobs";
import type {
  ExecutiveDateWindow,
  ExecutiveDateWindows,
  FormoriaExecutiveBusinessData,
  FormoriaExecutiveDataSource,
} from "@/lib/services/formoria-executive";
import { createServiceClient } from "@/lib/supabase/server";

type ApprovedBrandRow = {
  id: string;
  name: string;
  slug: string;
  approved_at: string | null;
};

type SubscriberRow = {
  confirmed_at: string | null;
  unsubscribed_at: string | null;
};

type AnalyticsRow = {
  brand_id: string;
  views: number;
  clicks: number;
};

type LinkClickRow = {
  destination: string;
  clicks: number;
};

type LatestJobRow = {
  id: string;
  status: string;
  completed_at: string | null;
  failed_count: number;
  target_total: number;
};

function assertResult<T>(result: {
  data: T | null;
  error: { message?: string } | null;
}): T {
  if (result.error)
    throw new Error(result.error.message ?? "Executive data query failed");
  return result.data as T;
}

function inWindow(value: string | null, window: ExecutiveDateWindow): boolean {
  if (!value) return false;
  const date = value.slice(0, 10);
  return date >= window.startDate && date <= window.endDate;
}

function countNetConfirmations(
  rows: SubscriberRow[],
  window: ExecutiveDateWindow,
): number {
  const confirmations = rows.filter((row) =>
    inWindow(row.confirmed_at, window),
  ).length;
  const unsubscribes = rows.filter((row) =>
    inWindow(row.unsubscribed_at, window),
  ).length;
  return confirmations - unsubscribes;
}

export function summarizeLocalEngagement(
  brands: ApprovedBrandRow[],
  analytics: AnalyticsRow[],
  links: LinkClickRow[],
): FormoriaExecutiveBusinessData["engagement"] {
  const brandsById = new Map(brands.map((brand) => [brand.id, brand]));
  const totals = new Map<string, { views: number; clicks: number }>();
  for (const row of analytics) {
    const current = totals.get(row.brand_id) ?? { views: 0, clicks: 0 };
    current.views += row.views;
    current.clicks += row.clicks;
    totals.set(row.brand_id, current);
  }

  const topBrands = Array.from(totals.entries())
    .flatMap(([id, total]) => {
      const brand = brandsById.get(id);
      return brand
        ? [{ id, name: brand.name, slug: brand.slug, ...total }]
        : [];
    })
    .sort(
      (left, right) => right.views - left.views || right.clicks - left.clicks,
    )
    .slice(0, 5);

  const destinations = new Map<string, number>();
  for (const row of links) {
    destinations.set(
      row.destination,
      (destinations.get(row.destination) ?? 0) + row.clicks,
    );
  }

  return {
    topBrands,
    destinationMix: Array.from(destinations, ([destination, clicks]) => ({
      destination,
      clicks,
    }))
      .sort((left, right) => right.clicks - left.clicks)
      .slice(0, 8),
  };
}

export function summarizeExecutiveBusinessData(
  input: {
    brands: ApprovedBrandRow[];
    owners: Array<{ brand_id: string }>;
    subscribers: SubscriberRow[];
    analytics: AnalyticsRow[];
    links: LinkClickRow[];
    activeJobs: number;
    latestJob: LatestJobRow | null;
  },
  windows: ExecutiveDateWindows,
): FormoriaExecutiveBusinessData {
  const approvedBrandIds = new Set(input.brands.map((brand) => brand.id));
  const claimedBrandIds = new Set(
    input.owners
      .filter((owner) => approvedBrandIds.has(owner.brand_id))
      .map((owner) => owner.brand_id),
  );

  return {
    supply: {
      approvedBrands: input.brands.length,
      newApproved: {
        current: input.brands.filter((brand) =>
          inWindow(brand.approved_at, windows.current),
        ).length,
        prior: input.brands.filter((brand) =>
          inWindow(brand.approved_at, windows.prior),
        ).length,
      },
      claimedShare:
        input.brands.length > 0
          ? claimedBrandIds.size / input.brands.length
          : 0,
    },
    audience: {
      confirmedSubscribers: input.subscribers.filter(
        (subscriber) => subscriber.confirmed_at && !subscriber.unsubscribed_at,
      ).length,
      netConfirmations: {
        current: countNetConfirmations(input.subscribers, windows.current),
        prior: countNetConfirmations(input.subscribers, windows.prior),
      },
    },
    engagement: summarizeLocalEngagement(
      input.brands,
      input.analytics,
      input.links,
    ),
    curation: {
      activeJobs: input.activeJobs,
      latestOutcome: input.latestJob
        ? {
            id: input.latestJob.id,
            status: input.latestJob.status,
            completedAt: input.latestJob.completed_at,
            failedCount: input.latestJob.failed_count,
            totalCount: input.latestJob.target_total,
          }
        : null,
    },
  };
}

async function loadBusinessData(
  windows: ExecutiveDateWindows,
): Promise<FormoriaExecutiveBusinessData> {
  const client = createServiceClient();
  const [
    brandsResult,
    ownersResult,
    subscribersResult,
    analyticsResult,
    linksResult,
    activeJobsResult,
    jobs,
  ] = await Promise.all([
    client
      .from("brands")
      .select("id, name, slug, approved_at")
      .eq("status", "approved"),
    client.from("brand_owners").select("brand_id"),
    client
      .from("newsletter_subscribers")
      .select("confirmed_at, unsubscribed_at"),
    client
      .from("brand_analytics")
      .select("brand_id, views, clicks")
      .gte("date", windows.current.startDate)
      .lte("date", windows.current.endDate),
    client
      .from("brand_link_clicks")
      .select("destination, clicks")
      .gte("date", windows.current.startDate)
      .lte("date", windows.current.endDate),
    client
      .from("curation_jobs")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "running"]),
    listCurationJobs({ limit: 1 }),
  ]);

  const brands = assertResult(brandsResult) as ApprovedBrandRow[];
  const owners = assertResult(ownersResult) as Array<{ brand_id: string }>;
  const subscribers = assertResult(subscribersResult) as SubscriberRow[];
  const analytics = assertResult(analyticsResult) as AnalyticsRow[];
  const links = assertResult(linksResult) as LinkClickRow[];
  if (activeJobsResult.error) throw new Error(activeJobsResult.error.message);
  const latestJob = jobs.jobs[0];

  return summarizeExecutiveBusinessData(
    {
      brands,
      owners,
      subscribers,
      analytics,
      links,
      activeJobs: activeJobsResult.count ?? 0,
      latestJob: latestJob ?? null,
    },
    windows,
  );
}

export function createSupabaseExecutiveDataSource(): FormoriaExecutiveDataSource {
  return { load: loadBusinessData };
}
