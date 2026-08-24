import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { excludeTestBrands } from "./public-brand-filter";

type CityCluster = {
  city: string;
  count: number;
};

export type CategoryPeerStats = {
  peerCount: number;
  cityClusters: CityCluster[];
};

type PeerStatsSupabase = Pick<SupabaseClient, "from">;

type CategoryPeerRow = {
  id: string;
  city: string | null;
};

function getClient(client?: PeerStatsSupabase): PeerStatsSupabase {
  return client ?? (createServiceClient() as unknown as PeerStatsSupabase);
}

/** Pipeline-only category context for FAQ enrichment. */
export async function getCategoryPeerStats(
  categorySlug: string | null | undefined,
  brandId: string,
  client?: PeerStatsSupabase,
): Promise<CategoryPeerStats | null> {
  if (!categorySlug?.trim()) return null;

  const { data, error } = await excludeTestBrands(
    getClient(client)
      .from("brands")
      .select("id, city")
      .eq("status", "approved")
      .eq("category", categorySlug),
  );

  if (error) throw error;

  const rows = ((data ?? []) as CategoryPeerRow[]).filter(
    (row) => row.id !== brandId,
  );
  const cityCounts = new Map<string, number>();

  for (const row of rows) {
    const city = row.city?.trim();
    if (city) cityCounts.set(city, (cityCounts.get(city) ?? 0) + 1);
  }

  return {
    peerCount: rows.length,
    cityClusters: [...cityCounts.entries()]
      .map(([city, count]) => ({ city, count }))
      .sort((left, right) =>
        right.count - left.count || left.city.localeCompare(right.city),
      ),
  };
}
