import { buildImageQueryVariants } from "@/lib/services/enrich-phases/scraper/search";

export type CaptureQueryBrand = {
  name: string;
  productType: string;
  purchaseWebsite?: string | null;
};

/**
 * Index of the query that is byte-identical to the single query production
 * issues (`buildImageQueryVariants`). Every measurement that claims to describe
 * production behaviour must be restricted to candidates captured by this query;
 * the remaining entries exist only to widen the labelling corpus.
 */
export const PRODUCTION_QUERY_INDEX = 0;

/**
 * Queries used to build the golden corpus.
 *
 * Query 0 is the production query, unmodified — production issues exactly this
 * one and nothing else, so before/after runs compare like with like.
 *
 * Queries 1..n are deliberate corpus-widening variants: labelling needs harder
 * negatives and more per-brand candidates than one SERP page yields. They are
 * kept, not deleted, but they are not production behaviour — see
 * PRODUCTION_QUERY_INDEX.
 *
 * The negative terms (`-優惠 -折扣 -特價 …`) that used to be appended here are
 * gone: they were measurably harmful and have been removed from production, and
 * leaving them in the capture path would have hidden exactly the promotional
 * images the classifier is supposed to learn to reject.
 */
export function buildCaptureQueries(brand: CaptureQueryBrand): string[] {
  const name = brand.name.trim();
  const productType = brand.productType.trim();
  const productionQuery =
    buildImageQueryVariants({ brandName: name, productType })[0] ??
    `"${name}" 台灣`;

  const queries = [
    productionQuery,
    `"${name}" ${productType} 官方網站 商品`,
    `"${name}" ${productType} 產品 圖片`,
    `"${name}" 台灣 品牌 商品`,
  ];

  if (brand.purchaseWebsite) {
    try {
      const host = new URL(brand.purchaseWebsite).hostname
        .toLowerCase()
        .replace(/^www\./, "");
      if (host) {
        const latinToken =
          name.match(/[A-Za-z0-9][A-Za-z0-9&.'-]*/)?.[0] ?? name;
        queries.push(`site:${host} ${latinToken}`);
      }
    } catch {
      // Ignore malformed purchase URLs; provider fallbacks remain available.
    }
  }

  return queries;
}

export function mergeCaptureCandidates<T extends { imageUrl: string }>(
  existing: readonly T[],
  additions: readonly T[],
  limit: number,
): T[] {
  const merged: T[] = [];
  const seen = new Set<string>();

  for (const candidate of [...existing, ...additions]) {
    if (seen.has(candidate.imageUrl)) continue;
    seen.add(candidate.imageUrl);
    merged.push(candidate);
    if (merged.length >= limit) break;
  }

  return merged;
}

export function underfilledCaptureBrands(
  counts: ReadonlyArray<{ name: string; count: number }>,
  requiredCount: number,
): string[] {
  return counts
    .filter((entry) => entry.count < requiredCount)
    .map((entry) => `${entry.name}=${entry.count}`);
}
