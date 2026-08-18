import { test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * Mirrors MIN_HOME_CURATED_PRODUCTS in src/lib/services/curated-products.ts.
 * Duplicated rather than imported so an e2e util never drags the service layer
 * (and its generated Supabase types) into the Playwright module graph.
 */
export const MIN_HOME_CURATED_PRODUCTS = 6;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WallSupplySupabase = ReturnType<typeof createClient<any, any, any>>;

/**
 * Homepage-eligible curated products, counted ONCE per worker and cached — the
 * answer is environment-level, exactly like `trailStatusProbe` in
 * discovery-trail.spec.ts, so every spec in the worker reuses it.
 *
 * `null` means "the count could not be taken" and is never evidence of a
 * regression.
 */
let supplyProbe: Promise<number | null> | undefined;

/** Test seam: drop the cached per-worker count. */
export function resetWallSupplyProbe(): void {
  supplyProbe = undefined;
}

/**
 * `curated_products` has RLS enabled with no policies and is revoked from
 * `anon`, so supply can only be counted with the service-role key. It is
 * present in all three e2e workflow envs; when it is not, the client
 * construction throws and the probe resolves to `null`.
 */
function serviceClient(): WallSupplySupabase {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * The publication gate of `getPublishedCuratedProductsForHomepage`, expressed
 * as a count. `visible = true` replaced the old lifecycle column, and image
 * usage is no longer a gate at all — keep this aligned with that query, since a
 * filter that drifts turns this guard into either a false red or a silent skip.
 */
async function countEligibleProducts(
  client: WallSupplySupabase,
): Promise<number> {
  const { count, error } = await client
    .from("curated_products")
    .select("id, curated_product_sources!inner(id), brands!inner(status)", {
      count: "exact",
      head: true,
    })
    .eq("visible", true)
    .not("official_url", "is", null)
    .not("source_checked_at", "is", null)
    .not("image_url", "is", null)
    .eq("curated_product_sources.state", "active")
    .eq("brands.status", "approved");

  if (error) throw error;
  return count ?? 0;
}

function homepageSupplyCount(
  client?: WallSupplySupabase,
): Promise<number | null> {
  supplyProbe ??= (async () => countEligibleProducts(client ?? serviceClient()))()
    .catch(() => null);
  return supplyProbe;
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
