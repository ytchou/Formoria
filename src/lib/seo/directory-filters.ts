import type { BrandFilters } from "@/lib/types";
import {
  parsePageParam,
  parseSortParam,
  type BrandSortOption,
} from "@/lib/pagination";
import { DEFERRED_CATEGORY_SLUGS } from "@/lib/taxonomy/ontology";

export type DirectorySearchParams = Record<
  string,
  string | string[] | undefined
>;

export type DirectoryViewFilters = Pick<BrandFilters, "search"> & {
  categorySlugs: string[];
  subcategorySlugs: string[];
};

export function parseCommaParam(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.flatMap((item) =>
    item
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

export function hasDeferredCategoryFilter(
  value: string | string[] | undefined,
): boolean {
  return parseCommaParam(value).some((slug) =>
    DEFERRED_CATEGORY_SLUGS.has(slug),
  );
}

export function parseDirectoryViewFilters(
  searchParams: DirectorySearchParams,
  validCategorySlugs: ReadonlySet<string>,
): { filters: DirectoryViewFilters; page: number; sort: BrandSortOption } {
  const categorySlugs = parseCommaParam(searchParams.category).filter((slug) =>
    validCategorySlugs.has(slug),
  );
  const singleCategory =
    categorySlugs.length === 1 ? (categorySlugs[0] ?? null) : null;

  return {
    page: parsePageParam(searchParams.page),
    sort: parseSortParam(searchParams.sort),
    filters: {
      search:
        typeof searchParams.search === "string"
          ? searchParams.search.trim()
          : "",
      categorySlugs,
      subcategorySlugs: singleCategory ? parseCommaParam(searchParams.sub) : [],
    },
  };
}
