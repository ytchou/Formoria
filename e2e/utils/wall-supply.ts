import { test } from "@playwright/test";
import type { createClient } from "@supabase/supabase-js";

import { getServiceClient } from "../helpers/seed";
// A LEAF module: it declares two string constants and imports nothing, so this
// does not drag the service layer into the Playwright module graph.
import { TEST_BRAND_NAME_PATTERN } from "../../src/lib/services/public-brand-filter";

/**
 * Mirrors MIN_HOME_CURATED_PRODUCTS in src/lib/services/curated-products.ts
 * (declared there at :66). Duplicated rather than imported so an e2e util never
 * drags the service layer (and its generated Supabase types, and through them
 * `sharp`) into the Playwright module graph. `wall-ratio.ts` is the leaf that
 * would hold it, but the floor is a SERVICE-layer publication constant and the
 * service is where its only other reader lives, so moving it there would split
 * the gate across two files instead of one.
 *
 * If that constant changes, change this one in the same commit.
 */
export const MIN_HOME_CURATED_PRODUCTS = 6;

/**
 * Mirrors `MAX_HOME_WALL_PRODUCTS` in src/lib/curated-products/home-wall.ts.
 *
 * Duplicated for a NARROWER reason than the floor above. `home-wall.ts`
 * value-imports `@/lib/date-range`, and nothing under `e2e/` has ever resolved
 * the `@/` alias — every existing e2e-to-src import points at an import-free
 * leaf. An unresolved alias fails the whole Playwright run at collection, which
 * is a far worse failure than a duplicated integer.
 *
 * The drift this normally costs is pinned rather than accepted: the unit test
 * beside this file imports the real constant (vitest DOES resolve `@/`) and
 * asserts it is equal, so changing the source reds a test in the same commit.
 */
export const MAX_HOME_WALL_PRODUCTS = 16;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WallSupplySupabase = ReturnType<typeof createClient<any, any, any>>;

/**
 * Homepage-eligible curated products, counted ONCE per worker and cached — the
 * answer is environment-level, exactly like `trailStatusProbe` in
 * discovery-trail.spec.ts, so every spec in the worker reuses it.
 *
 * Keyed by the CLIENT that took the count, so an injected client gets its own
 * answer instead of silently inheriting the default client's, and a FAILED
 * count is never cached: one transient Supabase timeout would otherwise skip
 * every later wall spec in the worker, which is how a real regression reports
 * green.
 *
 * `null` means "the count could not be taken" and is never evidence of a
 * regression.
 */
let supplyProbes = new WeakMap<object, Promise<number>>();

/** Test seam: drop the cached per-worker counts. */
export function resetWallSupplyProbe(): void {
  supplyProbes = new WeakMap();
}

/**
 * The publication gate of `getPublishedCuratedProductsForHomepage`
 * (src/lib/services/curated-products.ts:430), as a reusable filter chain.
 * `visible = true` replaced the old lifecycle column, and image usage is no
 * longer a gate at all — keep this aligned with that query AND with the row
 * loop under it, since a filter that drifts turns these guards into either a
 * false red or a silent skip.
 *
 * The two brand filters are that row loop: the service drops seeded `[E2E-TEST]`
 * brands and rows with no brand name, so a count that keeps them reports supply
 * the homepage will never render. The service also embeds
 * `curated_product_selections`, but that embed is NOT `!inner` — it narrows the
 * embedded rows only and never drops a product, so it is deliberately absent
 * here.
 *
 * Written once and shared by both probes on purpose. Two hand-copied filter
 * chains are two chances for one of them to drift out of step with the service,
 * and a drifted chain fails silently in the direction that looks green.
 */
function eligibleProductsQuery(
  client: WallSupplySupabase,
  select: string,
  options?: { count: "exact"; head: true },
) {
  return client
    .from("curated_products")
    .select(select, options)
    .eq("visible", true)
    .not("official_url", "is", null)
    .not("source_checked_at", "is", null)
    .not("image_url", "is", null)
    .eq("curated_product_sources.state", "active")
    .eq("brands.status", "approved")
    .not("brands.name", "like", TEST_BRAND_NAME_PATTERN)
    .not("brands.name", "is", null);
}

async function countEligibleProducts(
  client: WallSupplySupabase,
): Promise<number> {
  const { count, error } = await eligibleProductsQuery(
    client,
    "id, curated_product_sources!inner(id), brands!inner(name, status)",
    { count: "exact", head: true },
  );

  if (error) throw error;
  return count ?? 0;
}

/**
 * One count per client per worker, with a FAILED count never cached.
 *
 * `curated_products` has RLS enabled with no policies and is revoked from
 * `anon`, so it can only be read with the service-role key — the shared
 * memoized client in `../helpers/seed`. The key is present in all three e2e
 * workflow envs; when it is not, the read throws and this resolves to `null`.
 *
 * Shared by both probes so the eviction rule lives in ONE place: one transient
 * Supabase timeout must not disarm a guard for the rest of the worker, and a
 * second copy of that rule is a second chance to write it wrong.
 */
function memoizedCount(
  probes: WeakMap<object, Promise<number>>,
  client: WallSupplySupabase | undefined,
  take: (client: WallSupplySupabase) => Promise<number>,
): Promise<number | null> {
  let target: WallSupplySupabase;
  try {
    target = client ?? (getServiceClient() as unknown as WallSupplySupabase);
  } catch {
    return Promise.resolve(null);
  }

  const key = target as unknown as object;
  let probe = probes.get(key);
  if (!probe) {
    // Only a SUCCESSFUL count stays cached; the failure evicts itself so the
    // next spec in this worker takes the count again.
    probe = take(target).catch((error: unknown) => {
      if (probes.get(key) === probe) probes.delete(key);
      throw error;
    });
    probes.set(key, probe);
  }
  return probe.then(
    (count) => count,
    () => null,
  );
}

function homepageSupplyCount(
  client?: WallSupplySupabase,
): Promise<number | null> {
  return memoizedCount(supplyProbes, client, countEligibleProducts);
}

/**
 * Gate a wall spec on SUPPLY, never on the rendered DOM alone.
 *
 * `test.skip(count === 0)` cannot tell "the wall is legitimately below its
 * supply floor" from "the wall regressed out of the page" — both are an empty
 * selector, and both report green. That is not hypothetical: in DEV-1490 the
 * staging landing shipped with no selection zone while the database held 99
 * qualifying products, and every wall spec would have skipped past it.
 *
 * So the guard MEASURES supply instead of assuming it: an absent wall fails
 * only when the database actually holds `MIN_HOME_CURATED_PRODUCTS` eligible
 * products. Below that floor a hidden wall is correct behaviour, and a count
 * that cannot be taken skips rather than inventing a red.
 */
export async function requireWallOrSkip(
  wallIsAbsent: boolean,
  client?: WallSupplySupabase,
): Promise<void> {
  if (!wallIsAbsent) return;

  const supply = await homepageSupplyCount(client);
  if (supply !== null && supply >= MIN_HOME_CURATED_PRODUCTS) {
    throw new Error(
      `The homepage selection zone is missing while ${supply} curated products `
        + "clear the homepage publication gate — at or above "
        + `MIN_HOME_CURATED_PRODUCTS (${MIN_HOME_CURATED_PRODUCTS}). The wall `
        + "regressed — it did not fall below its supply gate. See DEV-1490 for "
        + "the last cause: a build that prerendered against a pre-migration "
        + "schema.",
    );
  }

  test.skip(
    true,
    "The homepage product wall is hidden below its public supply gate.",
  );
}
