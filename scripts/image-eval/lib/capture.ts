import { buildImageQueryVariants } from "@/lib/services/enrich-phases/scraper/search";

const IMAGE_NEGATIVE_TERMS = "-優惠 -折扣 -特價 -coupon";

export type CaptureQueryBrand = {
  name: string;
  productType: string;
  purchaseWebsite?: string | null;
};

export function buildCaptureQueries(brand: CaptureQueryBrand): string[] {
  const name = brand.name.trim();
  const productType = brand.productType.trim();
  const firstQuery =
    buildImageQueryVariants({ brandName: name, productType })[0] ??
    `"${name}" 台灣`;

  const queries = [
    firstQuery,
    `"${name}" ${productType} 官方網站 商品 ${IMAGE_NEGATIVE_TERMS}`,
    `"${name}" ${productType} 產品 圖片 ${IMAGE_NEGATIVE_TERMS}`,
    `"${name}" 台灣 品牌 商品 ${IMAGE_NEGATIVE_TERMS}`,
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
