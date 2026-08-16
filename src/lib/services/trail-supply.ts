import { cache } from "react";

import { captureReadFailure } from "@/lib/degraded-render";
import type { Locale } from "@/lib/seo/alternates";
import {
  trailIndexBlockers,
  type TrailIndexabilityFrontmatter,
  type TrailIndexabilityProduct,
} from "@/lib/seo/trail-indexability";
import { getPublishedCuratedProductsForTrail } from "@/lib/services/curated-products";
import {
  getAllTrails,
  type TrailEntry,
  type TrailListResult,
} from "@/lib/services/trails";

export type TrailSupplySelection = {
  /** Trails whose frontmatter and product slate clear every index blocker. */
  indexableSlugs: Set<string>;
  /** Trails whose product read failed — unknown supply, not empty supply. */
  failedSlugs: Set<string>;
};

/**
 * Pure supply gate over already-fetched data: one trail is indexable only when
 * `trailIndexBlockers` reports nothing.
 *
 * A `null` entry means the read failed and is reported through `failedSlugs`
 * rather than folded into "under-supplied". Callers that turn this into a 404
 * need that difference — treating a transient read failure as an empty slate
 * would bake a 404 for a trail that actually has content.
 */
export function selectIndexableTrails({
  trails,
  productsBySlug,
}: {
  trails: readonly TrailEntry[];
  productsBySlug: ReadonlyMap<string, readonly TrailIndexabilityProduct[] | null>;
}): TrailSupplySelection {
  const indexableSlugs = new Set<string>();
  const failedSlugs = new Set<string>();

  for (const trail of trails) {
    const products = productsBySlug.get(trail.slug) ?? null;
    if (products === null) {
      failedSlugs.add(trail.slug);
      continue;
    }

    if (
      trailIndexBlockers({ frontmatter: trail.frontmatter, products }).length === 0
    ) {
      indexableSlugs.add(trail.slug);
    }
  }

  return { indexableSlugs, failedSlugs };
}

/**
 * Decides whether a single trail detail route must 404 for want of supply.
 *
 * `products === null` means the read FAILED, not that the slate is empty, and
 * must never produce a 404 — `captureReadFailure` returns `null`, so without
 * this check a transient DB failure is indistinguishable from an empty slate.
 * Only `min_products` hides the page; every other blocker leaves the trail
 * reachable and merely noindex.
 */
export function shouldHideUnderSuppliedTrail({
  frontmatter,
  products,
}: {
  frontmatter: TrailIndexabilityFrontmatter;
  products: readonly TrailIndexabilityProduct[] | null;
}): boolean {
  if (products === null) return false;
  return trailIndexBlockers({ frontmatter, products }).includes("min_products");
}

export type TrailSupplyResult = {
  result: TrailListResult;
  indexableSlugs: Set<string>;
  /** Trails whose product read failed — unknown supply, not empty supply. */
  failedSlugs: Set<string>;
  /** True when any read failed, so the caller can opt out of the ISR cache. */
  degraded: boolean;
};

/**
 * Fetching wrapper around {@link selectIndexableTrails}. `cache()`-wrapped so
 * the hub's metadata and body — and the homepage — pay for one read per request.
 *
 * `scope` prefixes the Sentry scopes so a homepage failure is not triaged as a
 * `/discover` hub failure. Note `cache()` keys on arguments: every call site on
 * one surface must pass identical arguments or that surface fetches twice.
 */
export const getIndexableTrailSlugs = cache(
  async (locale: Locale, scope: string = "discover.hub"): Promise<TrailSupplyResult> => {
    const result = await getAllTrails(locale);
    if (!result.ok) {
      captureReadFailure(`${scope}.trails`)(result.error);
      return {
        result,
        indexableSlugs: new Set(),
        failedSlugs: new Set(),
        degraded: true,
      };
    }

    const entries = await Promise.all(
      result.trails.map(async (trail) => {
        try {
          const products = await getPublishedCuratedProductsForTrail(trail.slug);
          return [trail.slug, products] as const;
        } catch (error) {
          captureReadFailure(`${scope}.products.${trail.slug}`)(error);
          return [trail.slug, null] as const;
        }
      }),
    );

    const { indexableSlugs, failedSlugs } = selectIndexableTrails({
      trails: result.trails,
      productsBySlug: new Map(entries),
    });

    return { result, indexableSlugs, failedSlugs, degraded: failedSlugs.size > 0 };
  },
);
