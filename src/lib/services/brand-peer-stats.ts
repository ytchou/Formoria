import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { excludeTestBrands } from "./public-brand-filter";

/** Internal shapes of `CategoryPeerStats`; reached through it, never directly. */
type PriceDistribution = Record<1 | 2 | 3, number>;

type CityCluster = {
  city: string;
  count: number;
};

export type CategoryPeerStats = {
  peerCount: number;
  priceDistribution: PriceDistribution;
  cityClusters: CityCluster[];
};

type PeerStatsSupabase = Pick<SupabaseClient, "from">;

type CategoryPeerRow = {
  id: string;
  price_range: number | null;
  city: string | null;
};

function getClient(client?: PeerStatsSupabase): PeerStatsSupabase {
  return client ?? (createServiceClient() as unknown as PeerStatsSupabase);
}

/** Pipeline-only category context for FAQ enrichment. */
export async function getCategoryPeerStats(
  productType: string | null | undefined,
  brandId: string,
  client?: PeerStatsSupabase,
): Promise<CategoryPeerStats | null> {
  if (!productType?.trim()) return null;

  const { data, error } = await excludeTestBrands(
    getClient(client)
      .from("brands")
      .select("id, price_range, city")
      .eq("status", "approved")
      .eq("product_type", productType),
  );

  if (error) throw error;

  const rows = ((data ?? []) as CategoryPeerRow[]).filter(
    (row) => row.id !== brandId,
  );
  const priceDistribution: PriceDistribution = { 1: 0, 2: 0, 3: 0 };
  const cityCounts = new Map<string, number>();

  for (const row of rows) {
    if (row.price_range === 1 || row.price_range === 2 || row.price_range === 3) {
      priceDistribution[row.price_range] += 1;
    }
    const city = row.city?.trim();
    if (city) cityCounts.set(city, (cityCounts.get(city) ?? 0) + 1);
  }

  return {
    peerCount: rows.length,
    priceDistribution,
    cityClusters: [...cityCounts.entries()]
      .map(([city, count]) => ({ city, count }))
      .sort((left, right) =>
        right.count - left.count || left.city.localeCompare(right.city),
      ),
  };
}
