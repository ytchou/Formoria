"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { FilterToken } from "@/components/filters";
import { updateDirectoryUrl } from "@/lib/directory-filter-url";
import { parseCommaParam } from "@/lib/seo/directory-filters";

type ActiveFilter = {
  type: "subcategory" | "material";
  slug: string;
  label: string;
};

type ProductActiveFiltersProps = {
  activeFilters: ActiveFilter[];
};

export function ProductActiveFilters({
  activeFilters,
}: ProductActiveFiltersProps) {
  const t = useTranslations("products.filters");
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (activeFilters.length === 0) return null;

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

  const clearAllHref = updateDirectoryUrl(pathname, searchParams, {
    sub: null,
    material: null,
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
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
      {activeFilters.length > 1 && (
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
