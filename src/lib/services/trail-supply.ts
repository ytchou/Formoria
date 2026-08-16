import { cache } from "react";

import { captureReadFailure } from "@/lib/degraded-render";
import type { Locale } from "@/lib/seo/alternates";
import {
  trailIndexBlockers,
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

export type TrailSupplyResult = {
  result: TrailListResult;
  indexableSlugs: Set<string>;
  /** True when any read failed, so the caller can opt out of the ISR cache. */
  degraded: boolean;
};

/**
 * Fetching wrapper around {@link selectIndexableTrails}. `cache()`-wrapped so
 * the hub's metadata and body — and the homepage — pay for one read per request.
 */
export const getIndexableTrailSlugs = cache(
  async (locale: Locale): Promise<TrailSupplyResult> => {
    const result = await getAllTrails(locale);
    if (!result.ok) {
      captureReadFailure("discover.hub.trails")(result.error);
      return { result, indexableSlugs: new Set(), degraded: true };
    }

    const entries = await Promise.all(
      result.trails.map(async (trail) => {
        try {
          const products = await getPublishedCuratedProductsForTrail(trail.slug);
          return [trail.slug, products] as const;
        } catch (error) {
          captureReadFailure(`discover.hub.products.${trail.slug}`)(error);
          return [trail.slug, null] as const;
        }
      }),
    );

    const { indexableSlugs, failedSlugs } = selectIndexableTrails({
      trails: result.trails,
      productsBySlug: new Map(entries),
    });

    return { result, indexableSlugs, degraded: failedSlugs.size > 0 };
  },
);
