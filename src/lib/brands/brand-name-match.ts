import type { PublicBrandCard } from "./contracts";
import { normalizePublicSearchQuery } from "./normalize-public-search-query";

export type BrandNameMatch = Pick<
  PublicBrandCard,
  "id" | "slug" | "name" | "romanizedName" | "heroImageUrl"
>;

function normalizeName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function matchBrandNames(
  brands: readonly BrandNameMatch[],
  query: string,
): BrandNameMatch[] {
  const normalized = normalizePublicSearchQuery(normalizeName(query));
  if (!normalized) return [];
  // Same ideograph ranges as situation_query_bigrams.
  const cjkCount = (normalized.match(/[㐀-䶿一-鿿豈-﫿]/g) ?? []).length;
  const latinCount = (normalized.match(/[a-z]/g) ?? []).length;
  if (cjkCount < 2 && latinCount < 3) return [];

  return brands
    .flatMap((brand) => {
      const names = [brand.name, brand.romanizedName]
        .filter((name): name is string => !!name)
        .map(normalizeName);
      const hits = names.filter(
        (name) =>
          name && (name.includes(normalized) || normalized.includes(name)),
      );
      if (!hits.length) return [];
      return [
        {
          brand,
          prefix: hits.some(
            (name) =>
              name.startsWith(normalized) || normalized.startsWith(name),
          ),
        },
      ];
    })
    .sort(
      (a, b) =>
        Number(b.prefix) - Number(a.prefix) ||
        a.brand.name.length - b.brand.name.length ||
        a.brand.slug.localeCompare(b.brand.slug),
    )
    .slice(0, 6)
    .map((hit) => hit.brand);
}
