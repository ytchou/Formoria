"use client";

import { useMemo, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { VISIBLE_L1_CATEGORIES, categoryLabel } from "@/lib/taxonomy/ontology";
import { buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { FilterSection } from "./filter-section";
import { FilterCheckboxGroup } from "./filter-checkbox-group";
import { FilterDrawerShell } from "./filter-drawer-shell";
import { updateDirectoryUrl } from "@/lib/directory-filter-url";

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

export type FilterSidebarProps = {
  locale: string;
  activeCategory: string | null;
  allLabel: string;
  subcategoryOptions?: SubcategoryOption[];
  activeSubSlugs?: string[];
  materialOptions?: MaterialOption[];
  activeMaterials?: string[];
  totalCount: number;
  /** Builds the href for a category link (null = "All"). */
  categoryHref: (categorySlug: string | null) => string;
  /** i18n labels for section headings and ARIA. */
  labels: {
    title: string;
    subcategory: string;
    material: string;
  };
  /** Optional analytics callbacks. */
  onCategorySelect?: (slug: string) => void;
  onSubcategoryToggle?: (slug: string, category: string, count: number) => void;
  onMaterialToggle?: (slug: string, count: number) => void;
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

export function FilterSidebar({
  locale,
  activeCategory,
  allLabel,
  subcategoryOptions = [],
  activeSubSlugs = [],
  materialOptions = [],
  activeMaterials = [],
  categoryHref,
  labels,
  onCategorySelect,
  onSubcategoryToggle,
  onMaterialToggle,
}: FilterSidebarProps) {
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
      onSubcategoryToggle?.(
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
      onMaterialToggle?.(
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
    <nav aria-label={labels.title}>
      <ul className="flex flex-wrap gap-2 lg:flex-col lg:gap-1">
        <li>
          <Link
            href={categoryHref(null)}
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
                href={categoryHref(category.slug)}
                aria-current={isActive ? "page" : undefined}
                className={filterLinkClasses(isActive)}
                onClick={() => {
                  if (!isActive) onCategorySelect?.(category.slug);
                }}
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
            title={labels.subcategory}
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
            title={labels.material}
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

export type FilterDrawerProps = FilterSidebarProps & {
  triggerLabel: string;
  showResultsLabel: string;
  clearAllLabel: string;
};

export function FilterDrawer({
  triggerLabel,
  showResultsLabel,
  clearAllLabel,
  ...sidebarProps
}: FilterDrawerProps) {
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
      triggerLabel={triggerLabel}
      title={sidebarProps.labels.title}
      showResultsLabel={showResultsLabel}
      clearAllLabel={clearAllLabel}
      onClearAll={clearAll}
    >
      <FilterSidebar {...sidebarProps} />
    </FilterDrawerShell>
  );
}
