import { buildCategoryTabTarget } from "@/components/navigation/category-tab-target";
import { localizePath } from "@/i18n/locale-preference";
import type { BrandSortOption } from "@/lib/pagination";
import { routes } from "@/lib/routes";

/**
 * The directory's presentation decisions, as pure functions over the parsed
 * filters. `DirectoryView` renders them; nothing here reaches for I/O, so each
 * rule is asserted directly instead of through the component.
 */

/**
 * The L1 slugs a chip may claim.
 *
 * `directoryBrandCategoryFilter` is what the brand query conjoins, and it drops
 * the L1 entirely while an L2 is active — the L1 then only titles the page. A
 * chip derived from the raw selection instead would advertise a filter the
 * results do not obey: `/brands?category=bags-accessories&sub=backpacks` legitimately
 * lists a `fashion` brand tagged `backpacks`. The count beside the filter box
 * obeys the same rule for free, because it counts the rows that query returned.
 */
export function directoryCategoryChipSlugs(
  categorySlugs: readonly string[],
  subcategorySlugs: readonly string[],
): string[] {
  if (subcategorySlugs.length > 0) return [];
  return categorySlugs.length > 0 ? [...categorySlugs] : [];
}

/**
 * Whether the page may publish the directory-wide `ItemList`.
 *
 * INVARIANT: the directory `ItemList` ships only on a page that is INDEXABLE.
 * `indexable` is the robots decision `resolveDirectorySeo` already took for
 * this exact request — one source of truth, read rather than re-derived.
 *
 * The two used to be derived independently and disagreed on invalid input:
 * this predicate read the PARSED filters, where the closed vocabulary has
 * already dropped an unknown term, so `?material=xyz` arrived here as an empty
 * `materials` array and read as the unfiltered directory — while
 * `resolveDirectorySeo` reads the RAW query and marks that same URL
 * `noindex, follow`. The junk URL therefore shipped an `ItemList` of every
 * approved brand while telling crawlers not to index the page it described
 * (DEV-1524). Adding a second facet list here is what caused it; reading the
 * indexation decision itself is what cannot drift from it.
 *
 * The parsed checks below are kept because they are STRICTER than
 * indexability, not a second opinion on it: page 2 is indexable and still must
 * not republish the directory-wide list.
 */
export function shouldEmitDirectoryItemList(input: {
  /** The robots decision `resolveDirectorySeo` returned for this request. */
  indexable: boolean;
  categorySlugs: readonly string[];
  search: string;
  materials: readonly string[];
  page: number;
}): boolean {
  return (
    input.indexable &&
    input.categorySlugs.length === 0 &&
    !input.search &&
    input.materials.length === 0 &&
    input.page === 1
  );
}

export type DirectoryUrlStateInput = {
  locale: string;
  /** The single valid L1 the page is titled by, when there is one. */
  category?: { slug: string } | undefined;
  /** The single resolved L2, when exactly one is active. */
  subcategory?: { slug: string; category: string } | undefined;
  /** Valid L1 slugs: selection state, not necessarily what the query conjoins. */
  categorySlugs: readonly string[];
  /** Resolved L2 slugs. */
  subcategorySlugs: readonly string[];
  search: string;
  materials: readonly string[];
  sort: BrandSortOption;
};

export type DirectoryUrlState = {
  locale: string;
  /** The unlocalized surface this state lives on. */
  routePath: string;
  /** `routePath` for the active locale. */
  directoryPath: string;
  /** Every axis the URL carries, taxonomy included where the surface allows. */
  normalizedParams: URLSearchParams;
  /** `normalizedParams` minus the taxonomy keys. */
  facetParams: URLSearchParams;
};

/** Resolve the surface and query string this set of filters is addressed by. */
export function buildDirectoryUrlState(
  input: DirectoryUrlStateInput,
): DirectoryUrlState {
  // All directory views live on `/brands` with query-string facets.
  const routePath = routes.brands();
  const normalizedParams = new URLSearchParams();
  if (input.search) normalizedParams.set("search", input.search);
  if (input.categorySlugs.length > 0) {
    normalizedParams.set("category", input.categorySlugs.join(","));
  }
  if (input.subcategorySlugs.length > 0) {
    normalizedParams.set("sub", input.subcategorySlugs.join(","));
  }
  if (input.materials.length > 0)
    normalizedParams.set("material", input.materials.join(","));
  if (input.sort !== "random") normalizedParams.set("sort", input.sort);

  const facetParams = new URLSearchParams(normalizedParams);
  facetParams.delete("category");
  facetParams.delete("sub");

  return {
    locale: input.locale,
    routePath,
    directoryPath: localizePath(routePath, input.locale),
    normalizedParams,
    facetParams,
  };
}

/**
 * The URL for a taxonomy state, on whichever surface owns it.
 *
 * All taxonomy now lives in the query string on `/brands`. `buildCategoryTabTarget`
 * is the one resolver that renders a taxonomy state as a URL, and it is given
 * the facet-only query so an orthogonal facet survives the move.
 */
export function directoryTaxonomyHref(
  state: DirectoryUrlState,
  categorySlugs: readonly string[],
  subSlugs: readonly string[],
): string {
  return buildCategoryTabTarget({
    pathname: state.routePath,
    searchParams: state.facetParams.toString(),
    slug: categorySlugs[0] ?? "",
    categorySlugs: [...categorySlugs],
    subSlug: subSlugs.length > 0 ? subSlugs.join(",") : null,
    locale: state.locale,
  }).href;
}
