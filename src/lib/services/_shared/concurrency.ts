/**
 * How many brands one enrichment batch fetches SERP/image results for. Lives
 * here (next to `mapWithConcurrency`) so leaf services can size themselves
 * against the pipeline without importing the whole curation module.
 *
 * Deliberately NOT shared with the look-alike constants below — each governs a
 * different resource, so unifying them would couple unrelated limits:
 * - `ENRICH_BRAND_CONCURRENCY` (curation-operations): composite fan-out, one
 *   unit = Serper + OpenAI + Postgres + sharp.
 * - `TARGET_PROGRESS_BATCH_SIZE` (curation-operations): Postgres write
 *   amplification.
 * - `FALLBACK_CONCURRENCY` (enrich-phases/channels), `CRAWL_CONCURRENCY`
 *   (scraper/strategies/crawl): politeness toward third-party hosts.
 * - `SUPABASE_IN_FILTER_CHUNK_SIZE`: Postgres IN-clause limit.
 */
export const ENRICH_CHUNK_SIZE = 20;

/**
 * Bounded parallel map. Extracted from curation-operations so heavier leaf
 * services (image download) can bound their own fan-out without importing the
 * whole curation module, which would create an import cycle.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  callback: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new Error("Concurrency must be a positive integer");
  }

  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await callback(items[index]!, index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}
