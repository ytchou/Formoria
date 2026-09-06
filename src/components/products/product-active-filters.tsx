"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { FilterToken } from "@/components/filters";
import { updateDirectoryUrl } from "@/lib/directory-filter-url";
import { parseCommaParam } from "@/lib/seo/directory-filters";
import { hrefWithoutQuery } from "@/lib/products/discover-search-params";

type ActiveFilter = {
  type: "subcategory" | "material";
  slug: string;
  label: string;
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

  // Clear all: drop sub, material, and q
  const clearAllBase = updateDirectoryUrl(pathname, searchParams, {
    sub: null,
    material: null,
  });
  // If q is present, also strip it from the cleared URL
  const clearAllHref = hasQuery
    ? hrefWithoutQuery(
        pathname,
        new URLSearchParams(
          clearAllBase.includes("?") ? clearAllBase.split("?")[1]! : "",
        ),
      )
    : clearAllBase;

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
      {activeFilters.map((filter) => (
        <FilterToken
          key={`${filter.type}-${filter.slug}`}
          href={removeHref(filter)}
          label={
            filter.type === "subcategory" ? t("subcategory") : t("material")
          }
          removeLabel={t("removeFilter", {
            label:
              filter.type === "subcategory" ? t("subcategory") : t("material"),
            value: filter.label,
          })}
          value={filter.label}
          variant="chip"
        />
      ))}
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
