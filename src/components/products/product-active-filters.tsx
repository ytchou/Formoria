"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { FilterToken } from "@/components/filters";
import {
  updateDirectoryUrl,
  type DirectoryFilterUpdates,
} from "@/lib/directory-filter-url";
import { parseCommaParam } from "@/lib/seo/directory-filters";
import {
  discoverClearAllKeys,
  hrefWithoutQuery,
} from "@/lib/products/discover-search-params";

export type ActiveFilter = {
  type: "category" | "subcategory" | "material";
  slug: string;
  label: string;
  /**
   * Filled in by the search rather than chosen by the visitor. Set by the
   * server so the 自動判斷 badge is in the first HTML, before any URL sync.
   */
  inferred?: boolean;
};

type ProductActiveFiltersProps = {
  activeFilters: ActiveFilter[];
  /** Active situation-search query, shown as a dismissible token. */
  query?: string | null;
};

export function ProductActiveFilters({
  activeFilters,
  query,
}: ProductActiveFiltersProps) {
  const t = useTranslations("products.filters");
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const hasQuery = Boolean(query?.trim());
  if (activeFilters.length === 0 && !hasQuery) return null;

  function removeHref(filter: ActiveFilter): string {
    // Also clears `sub`, which is scoped to the category.
    if (filter.type === "category") {
      return updateDirectoryUrl(pathname, searchParams, { category: null });
    }
    if (filter.type === "subcategory") {
      const currentSubs = parseCommaParam(
        searchParams.get("sub") ?? undefined,
      ).filter((s) => s !== filter.slug);
      return updateDirectoryUrl(pathname, searchParams, {
        sub: currentSubs.length > 0 ? currentSubs.join(",") : null,
      });
    }
    // material
    const currentMats = parseCommaParam(
      searchParams.get("material") ?? undefined,
    ).filter((s) => s !== filter.slug);
    return updateDirectoryUrl(pathname, searchParams, {
      material: currentMats.length > 0 ? currentMats.join(",") : null,
    });
  }

  // Clear all: drop sub and material; in search mode also category, the
  // inferred marker and q, so the visitor is back to an unfiltered page.
  const clearAllUpdates: DirectoryFilterUpdates = { sub: null, material: null };
  for (const key of discoverClearAllKeys(searchParams)) {
    clearAllUpdates[key] = null;
  }
  const clearAllHref = updateDirectoryUrl(
    pathname,
    searchParams,
    clearAllUpdates,
  );

  const queryDismissHref = hasQuery
    ? hrefWithoutQuery(pathname, searchParams)
    : null;

  const totalTokens = activeFilters.length + (hasQuery ? 1 : 0);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {hasQuery && queryDismissHref && (
        <FilterToken
          key="query"
          href={queryDismissHref}
          label={t("query")}
          removeLabel={t("removeFilter", {
            label: t("query"),
            value: query!,
          })}
          value={query!}
          variant="chip"
        />
      )}
      {activeFilters.map((filter) => {
        const label = t(filter.type);
        const badge = filter.inferred ? t("inferred") : undefined;
        return (
          <FilterToken
            key={`${filter.type}-${filter.slug}`}
            href={removeHref(filter)}
            label={label}
            removeLabel={
              badge
                ? t("removeFilterInferred", {
                    label,
                    value: filter.label,
                    badge,
                  })
                : t("removeFilter", { label, value: filter.label })
            }
            value={filter.label}
            variant="chip"
            badge={badge}
          />
        );
      })}
      {totalTokens > 1 && (
        <Link
          href={clearAllHref}
          replace
          scroll={false}
          prefetch={false}
          className="type-body-sm text-ink-muted underline-offset-2 hover:text-ink hover:underline"
        >
          {t("clearAll")}
        </Link>
      )}
    </div>
  );
}
