import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { excludeTestBrands } from "./public-brand-filter";

export type CategoryPeerStats = {
  peerCount: number;
};

type PeerStatsSupabase = Pick<SupabaseClient, "from">;

type CategoryPeerRow = {
  id: string;
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
      .select("id")
      .eq("status", "approved")
      .eq("category", categorySlug),
  );

  if (error) throw error;

  const rows = ((data ?? []) as CategoryPeerRow[]).filter(
    (row) => row.id !== brandId,
  );
  return { peerCount: rows.length };
}
