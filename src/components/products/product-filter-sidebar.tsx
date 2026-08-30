"use client";

import { useMemo, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { VISIBLE_L1_CATEGORIES, categoryLabel } from "@/lib/taxonomy/ontology";
import { routes } from "@/lib/routes";
import { buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  FilterSection,
  FilterCheckboxGroup,
  FilterDrawerShell,
} from "@/components/filters";
import { updateDirectoryUrl } from "@/lib/directory-filter-url";
import {
  trackProductSubcategoryFilterApplied,
  trackProductMaterialFilterApplied,
} from "@/lib/analytics";

type SubcategoryOption = {
  slug: string;
  label: string;
  count: number;
};

type MaterialOption = {
  value: string;
  label: string;
  count: number;
};

type ProductFilterSidebarProps = {
  locale: string;
  activeCategory: string | null;
  allLabel: string;
  subcategoryOptions?: SubcategoryOption[];
  activeSubSlugs?: string[];
  materialOptions?: MaterialOption[];
  activeMaterials?: string[];
  totalCount: number;
};

function filterLinkClasses(isActive: boolean) {
  return cn(
    buttonVariants({
      variant: isActive ? "primary" : "ghost",
      size: "compact",
    }),
    "type-nav justify-start",
    !isActive && "text-ink-muted",
  );
}

export function ProductFilterSidebar({
  locale,
  activeCategory,
  allLabel,
  subcategoryOptions = [],
  activeSubSlugs = [],
  materialOptions = [],
  activeMaterials = [],
  totalCount: _totalCount,
}: ProductFilterSidebarProps) {
  const t = useTranslations("products.filters");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const activeSubSet = useMemo(
    () => new Set(activeSubSlugs),
    [activeSubSlugs],
  );
  const activeMaterialSet = useMemo(
    () => new Set(activeMaterials),
    [activeMaterials],
  );

  const hasSubcategories =
    activeCategory !== null && subcategoryOptions.length > 0;
  const hasMaterials = materialOptions.length > 0;

  // Map subcategory options to FilterCheckboxGroup shape
  const subCheckboxOptions = useMemo(
    () =>
      subcategoryOptions.map((opt) => ({
        value: opt.slug,
        label: opt.label,
        count: opt.count,
      })),
    [subcategoryOptions],
  );

  function toggleSubcategory(value: string, checked: boolean) {
    const next = new Set(activeSubSet);
    if (checked) {
      next.add(value);
      trackProductSubcategoryFilterApplied(
        value,
        activeCategory!,
        subcategoryOptions.find((o) => o.slug === value)?.count ?? 0,
      );
    } else {
      next.delete(value);
    }
    startTransition(() => {
      router.replace(
        updateDirectoryUrl(pathname, searchParams, {
          sub: next.size > 0 ? Array.from(next).join(",") : null,
        }),
        { scroll: false },
      );
    });
  }

  function toggleMaterial(value: string, checked: boolean) {
    const next = new Set(activeMaterialSet);
    if (checked) {
      next.add(value);
      trackProductMaterialFilterApplied(
        value,
        materialOptions.find((o) => o.value === value)?.count ?? 0,
      );
    } else {
      next.delete(value);
    }
    startTransition(() => {
      router.replace(
        updateDirectoryUrl(pathname, searchParams, {
          material: next.size > 0 ? Array.from(next).join(",") : null,
        }),
        { scroll: false },
      );
    });
  }

  return (
    <nav aria-label={t("title")}>
      <ul className="flex flex-wrap gap-2 lg:flex-col lg:gap-1">
        <li>
          <Link
            href={routes.discover()}
            aria-current={activeCategory === null ? "page" : undefined}
            className={filterLinkClasses(activeCategory === null)}
          >
            {allLabel}
          </Link>
        </li>
        {VISIBLE_L1_CATEGORIES.map((category) => {
          const isActive = activeCategory === category.slug;
          const label = categoryLabel(category, locale);
          return (
            <li key={category.slug}>
              <Link
                href={routes.discover({ category: category.slug })}
                aria-current={isActive ? "page" : undefined}
                className={filterLinkClasses(isActive)}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>

      {hasSubcategories && (
        <>
          <Separator className="my-4" />
          <FilterSection
            title={t("subcategory")}
            defaultOpen={activeSubSlugs.length > 0}
          >
            <FilterCheckboxGroup
              options={subCheckboxOptions}
              activeValues={activeSubSet}
              onToggle={toggleSubcategory}
            />
          </FilterSection>
        </>
      )}

      {hasMaterials && (
        <>
          <Separator className="my-4" />
          <FilterSection
            title={t("material")}
            defaultOpen={activeMaterials.length > 0}
          >
            <FilterCheckboxGroup
              options={materialOptions}
              activeValues={activeMaterialSet}
              onToggle={toggleMaterial}
            />
          </FilterSection>
        </>
      )}
    </nav>
  );
}

export function ProductFilterDrawer(props: ProductFilterSidebarProps) {
  const t = useTranslations("products.filters");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function clearAll() {
    startTransition(() => {
      router.replace(
        updateDirectoryUrl(pathname, searchParams, {
          sub: null,
          material: null,
        }),
        { scroll: false },
      );
    });
  }

  return (
    <FilterDrawerShell
      triggerLabel={t("trigger")}
      title={t("title")}
      showResultsLabel={t("showResults", { count: props.totalCount })}
      clearAllLabel={t("clearAll")}
      onClearAll={clearAll}
    >
      <ProductFilterSidebar {...props} />
    </FilterDrawerShell>
  );
}
