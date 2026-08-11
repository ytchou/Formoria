/**
 * Batched reads of active `brand_images` rows for a set of brands.
 *
 * Extracted because two call sites — `getAdminBrandReviewImages` and
 * `hydrateCardImageMeta` — had independently grown the same chunk-plus-page
 * loop, with duplicate copies of both constants and, more importantly, of the
 * `.order()`-before-`.range()` invariant. That invariant is the load-bearing
 * part and the easiest to drop: `.range()` over an unordered result set can
 * repeat or skip rows between pages, and the symptom (a card missing its alt
 * text, occasionally) is indistinguishable from ordinary missing data. It now
 * exists in exactly one place.
 *
 * The two callers still differ in what they select and how they chunk, so those
 * stay parameters — this owns the pagination, not the projection.
 */

/**
 * PostgREST caps a response, not a filter list, so a chunk of 200 brands can
 * still exceed the row cap: a brand carries 10-14 active images, so 200 brands
 * is ~2,800 rows. Page through them rather than silently truncating at the cap.
 */
export const BRAND_IMAGE_PAGE_SIZE = 1_000;

/**
 * PostgREST sends `.in()` in the GET query string, so the real limit is the
 * request-line length, not the row count. UUIDs are a fixed 36 characters, so a
 * flat count is a safe proxy for them: 200 ids is ~7.4 KB of query string,
 * comfortably inside the usual 8-16 KB server limits.
 */
const BRAND_IMAGE_IN_FILTER_CHUNK_SIZE = 200;

/**
 * Budget for a `.in('url', ...)` filter, in characters.
 *
 * URLs are NOT fixed width, so the id chunk size above is the wrong tool for
 * them — this is the same reasoning (and the same number) as
 * `IN_FILTER_URL_BUDGET` in `image-download.ts`, which exists because signed
 * CDN URLs past 700 characters each blew the URI limit after only a couple of
 * dozen values. Supabase storage public URLs run ~110-130 characters, so this
 * lands around 15-18 brands per request.
 *
 * Ceiling: this trades round trips for payload. Narrowing to hero URLs discards
 * ~90% of the rows server-side, which is the right call while pages request a
 * few dozen cards. Upgrade path if a caller ever needs hundreds of brands in one
 * hydrate: move the hero lookup into a database view or RPC keyed on
 * `(brand_id, url)` so neither list has to travel in the query string.
 */
const BRAND_IMAGE_URL_FILTER_BUDGET = 2_000;

/** One request's worth of filters. `urls`, when present, narrows the rows further. */
export type BrandImageBatch = {
  brandIds: string[];
  urls?: string[];
};

/** Chunk brand ids for a plain `.in('brand_id', ...)` read of every active row. */
export function chunkBrandIdBatches(brandIds: string[]): BrandImageBatch[] {
  const batches: BrandImageBatch[] = [];
  for (
    let index = 0;
    index < brandIds.length;
    index += BRAND_IMAGE_IN_FILTER_CHUNK_SIZE
  ) {
    batches.push({
      brandIds: brandIds.slice(index, index + BRAND_IMAGE_IN_FILTER_CHUNK_SIZE),
    });
  }
  return batches;
}

/**
 * Chunk (brand, hero url) pairs so BOTH `.in()` lists stay inside their limits.
 *
 * Chunked by cumulative URL length rather than by count, because one long URL
 * costs as much request line as ten short ones — the same approach
 * `image-download.ts` already uses. The brand-id cap still applies, so whichever
 * limit binds first wins.
 *
 * Note the shape: `brandIds` and `urls` are two independent `.in()` filters, so
 * the query matches their cross product, not the pairs. That is deliberate and
 * safe here — a row for brand A carrying brand B's hero URL is simply extra
 * noise that the per-brand URL match at the call site ignores, and no row that
 * SHOULD match can be excluded.
 */
export function chunkBrandHeroUrlBatches(
  pairs: Array<{ brandId: string; url: string }>,
): BrandImageBatch[] {
  const batches: BrandImageBatch[] = [];
  let brandIds: string[] = [];
  let urls: string[] = [];
  let budget = 0;

  const flush = () => {
    if (brandIds.length === 0) return;
    batches.push({ brandIds, urls });
    brandIds = [];
    urls = [];
    budget = 0;
  };

  for (const pair of pairs) {
    // A single over-budget URL still has to go somewhere: give it its own batch
    // rather than dropping it or wedging it into a full one.
    const overBudget = budget + pair.url.length > BRAND_IMAGE_URL_FILTER_BUDGET;
    const overCount = brandIds.length >= BRAND_IMAGE_IN_FILTER_CHUNK_SIZE;
    if (brandIds.length > 0 && (overBudget || overCount)) flush();
    brandIds.push(pair.brandId);
    urls.push(pair.url);
    budget += pair.url.length;
  }
  flush();

  return batches;
}

/**
 * The slice of a Supabase client this helper uses.
 *
 * Callers pass `supabase as unknown as BrandImageQueryClient`. The cast is
 * deliberate and matches the idiom already used elsewhere in `lib/services`:
 * checking the real client's fully-generic query builder against a structural
 * type like this one makes TypeScript give up with "type instantiation is
 * excessively deep". Nothing is lost — `createServiceClient` carries no
 * `<Database>` generic anyway, so it never type-checked these column names.
 */
export type BrandImageQueryClient = {
  from(table: "brand_images"): {
    select(columns: string): BrandImageFilterChain;
  };
};

type BrandImageFilterChain = {
  in(column: "brand_id" | "url", values: string[]): BrandImageFilterChain;
  eq(column: "status", value: string): BrandImageFilterChain;
  order(
    column: string,
    options: { ascending: boolean },
  ): BrandImageFilterChain;
  range(
    from: number,
    to: number,
  ): PromiseLike<{ data: unknown[] | null; error: unknown }>;
};

/**
 * Read every active `brand_images` row matching each batch, paging within a
 * batch and running batches concurrently.
 *
 * Throws on a query error. Callers decide whether that is fatal —
 * `hydrateCardImageMeta` deliberately does not.
 */
export async function fetchActiveBrandImageRows<Row>(
  supabase: BrandImageQueryClient,
  select: string,
  batches: BrandImageBatch[],
): Promise<Row[]> {
  const pages = await Promise.all(
    batches.map(async (batch) => {
      const rows: Row[] = [];
      for (let offset = 0; ; offset += BRAND_IMAGE_PAGE_SIZE) {
        let query = supabase
          .from("brand_images")
          .select(select)
          .in("brand_id", batch.brandIds);
        if (batch.urls) query = query.in("url", batch.urls);
        const { data, error } = await query
          .eq("status", "active")
          // LOAD-BEARING, not cosmetic: `.range()` over an unordered result set
          // may repeat or skip rows between pages. A total order on
          // (brand_id, sort_order, id) makes paging stable, and the
          // sort_order component is what lets callers take the first match as
          // the lowest-sort_order one.
          .order("brand_id", { ascending: true })
          .order("sort_order", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + BRAND_IMAGE_PAGE_SIZE - 1);
        if (error) throw error;
        const page = (data ?? []) as Row[];
        rows.push(...page);
        if (page.length < BRAND_IMAGE_PAGE_SIZE) break;
      }
      return rows;
    }),
  );

  return pages.flat();
}
