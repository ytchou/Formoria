/**
 * Freshness of the curation-worker cron, read from the database. The worker is
 * a Railway cron one-shot with no HTTP server, so its newest `trigger = 'cron'`
 * job is the only evidence it ran. Shared by the executive-health check and the
 * health-agent curation-jobs detector so both read and round it the same way.
 */

export type LatestCronJob = { id: string; created_at: string | null };

type LatestCronQuery = {
  from(table: "curation_jobs"): {
    select(columns: string): {
      eq(column: string, value: string): {
        order(
          column: string,
          options: { ascending: boolean },
        ): {
          range(
            from: number,
            to: number,
          ): PromiseLike<{ data: unknown; error: unknown }>;
        };
      };
    };
  };
};

/** Newest `trigger = 'cron'` job, or null when none exists. */
export async function readLatestCronJob(
  supabase: unknown,
): Promise<LatestCronJob | null> {
  const { data, error } = await (supabase as LatestCronQuery)
    .from("curation_jobs")
    .select("id, created_at")
    .eq("trigger", "cron")
    .order("created_at", { ascending: false })
    .range(0, 0);
  if (error) throw error;
  return (data as LatestCronJob[] | null)?.at(0) ?? null;
}

/** Whole hours for display; one rounding rule for every cron-freshness message. */
export function cronAgeHours(ageMs: number): number {
  return Math.round(ageMs / 3_600_000);
}
