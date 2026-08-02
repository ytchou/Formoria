import { stableNumber } from "./hash";
import type { GoldenRosterBrand, GoldenSplit } from "./types";

const DEV_BRAND_COUNT = 35;
const HOLDOUT_BRAND_COUNT = 15;
const HOLDOUT_PER_CATEGORY = 1;
const SPLIT_SEED = "dev-1279-brand-split-v1";

export function splitRoster(
  brands: Omit<GoldenRosterBrand, "split">[],
): GoldenRosterBrand[] {
  if (brands.length !== DEV_BRAND_COUNT + HOLDOUT_BRAND_COUNT) {
    throw new Error(`Expected 50 brands, received ${brands.length}`);
  }

  const byCategory = new Map<string, Omit<GoldenRosterBrand, "split">[]>();
  for (const brand of brands) {
    const category = byCategory.get(brand.productType) ?? [];
    category.push(brand);
    byCategory.set(brand.productType, category);
  }

  const holdoutIds = new Set<string>();
  for (const [category, categoryBrands] of byCategory.entries()) {
    const shuffled = [...categoryBrands].toSorted((left, right) => {
      const hashDifference =
        stableNumber(`${SPLIT_SEED}:category:${category}:${left.slug}`) -
        stableNumber(`${SPLIT_SEED}:category:${category}:${right.slug}`);
      return hashDifference || left.slug.localeCompare(right.slug);
    });
    for (const brand of shuffled.slice(0, HOLDOUT_PER_CATEGORY)) {
      holdoutIds.add(brand.id);
    }
  }

  const additionalHoldout = brands
    .filter((brand) => !holdoutIds.has(brand.id))
    .toSorted((left, right) => {
      const hashDifference =
        stableNumber(`${SPLIT_SEED}:additional:${left.slug}`) -
        stableNumber(`${SPLIT_SEED}:additional:${right.slug}`);
      return hashDifference || left.slug.localeCompare(right.slug);
    });

  for (const brand of additionalHoldout) {
    if (holdoutIds.size >= HOLDOUT_BRAND_COUNT) break;
    holdoutIds.add(brand.id);
  }

  if (holdoutIds.size !== HOLDOUT_BRAND_COUNT) {
    throw new Error(`Unable to create a ${HOLDOUT_BRAND_COUNT}-brand holdout`);
  }

  return brands
    .map((brand) => ({
      ...brand,
      split: holdoutIds.has(brand.id) ? ("holdout" as const) : ("dev" as const),
    }))
    .sort(
      (left, right) =>
        left.productType.localeCompare(right.productType) ||
        left.slug.localeCompare(right.slug),
    );
}

export function countSplits(
  brands: readonly GoldenRosterBrand[],
): Record<GoldenSplit, number> {
  return brands.reduce<Record<GoldenSplit, number>>(
    (counts, brand) => {
      counts[brand.split] += 1;
      return counts;
    },
    { dev: 0, holdout: 0 },
  );
}
