"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
import { FilterSection } from "./filter-section";
import { FilterCheckboxGroup } from "./filter-checkbox-group";
import { FilterDrawerShell } from "./filter-drawer-shell";
import { useResultsTransition } from "./results-transition";
import {
  updateDirectoryUrl,
  type DirectoryClearKey,
  type DirectoryFilterUpdates,
} from "@/lib/directory-filter-url";

export type SubcategoryOption = {
  slug: string;
  label: string;
  count: number;
  /** Parent L1. Required to check a subcategory while no category is active. */
  category?: string;
};

type MaterialOption = {
  value: string;
  label: string;
  count: number;
};

export type FilterSidebarProps = {
  activeCategory: string | null;
  subcategoryOptions?: SubcategoryOption[];
  activeSubSlugs?: string[];
  materialOptions?: MaterialOption[];
  activeMaterials?: string[];
  totalCount: number;
  /**
   * Render no counts on any row (subcategories, materials).
   * The counts are catalog-wide, so they would contradict an active search.
   */
  hideCounts?: boolean;
  /** i18n labels for section headings and ARIA. */
  labels: {
    title: string;
    subcategory: string;
    material: string;
    showMore: (count: number) => string;
    showLess: string;
  };
  /** Optional analytics callbacks. */
  onSubcategoryToggle?: (slug: string, category: string, count: number) => void;
  onMaterialToggle?: (slug: string, count: number) => void;
};

/**
 * The 子分類 and 材質 panel shared by /discover and /brands. Both pages pick
 * the L1 category from a chip row above the results (R2-10), so the panel has
 * no category group.
 */
export function FilterSidebar({
  activeCategory,
  subcategoryOptions = [],
  activeSubSlugs = [],
  materialOptions = [],
  activeMaterials = [],
  hideCounts = false,
  labels,
  onSubcategoryToggle,
  onMaterialToggle,
}: FilterSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useResultsTransition();

  const activeSubSet = useMemo(
    () => new Set(activeSubSlugs),
    [activeSubSlugs],
  );
  const activeMaterialSet = useMemo(
    () => new Set(activeMaterials),
    [activeMaterials],
  );

  // With no active category both pages pass every visible L1's subcategories,
  // but a page may pass none (e.g. a multi-category selection), so presence
  // alone decides.
  const hasSubcategories = subcategoryOptions.length > 0;
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
    const option = subcategoryOptions.find((o) => o.slug === value);
    const parent = activeCategory ?? option?.category ?? null;
    const next = new Set(activeSubSet);
    let updates: DirectoryFilterUpdates;
    if (checked && activeCategory === null && parent) {
      // Checking under 全部 scopes the URL to the sub's L1: category and sub
      // move together in one patch (updateDirectoryUrl keeps an explicit sub).
      // Material drops too, as on a category link: the new L1 may not offer it.
      updates = { category: parent, sub: value, material: null };
    } else {
      if (checked) next.add(value);
      else next.delete(value);
      updates = { sub: next.size > 0 ? Array.from(next).join(",") : null };
    }
    if (checked && parent) {
      onSubcategoryToggle?.(value, parent, option?.count ?? 0);
    }
    startTransition(() => {
      router.replace(updateDirectoryUrl(pathname, searchParams, updates), {
        scroll: false,
      });
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
    <nav aria-label={labels.title} className="space-y-6">
      {hasSubcategories && (
        <FilterSection title={labels.subcategory}>
          <FilterCheckboxGroup
            options={subCheckboxOptions}
            activeValues={activeSubSet}
            onToggle={toggleSubcategory}
            showMoreLabel={labels.showMore}
            showLessLabel={labels.showLess}
            hideCounts={hideCounts}
          />
        </FilterSection>
      )}

      {hasMaterials && (
        <FilterSection title={labels.material}>
          <FilterCheckboxGroup
            options={materialOptions}
            activeValues={activeMaterialSet}
            onToggle={toggleMaterial}
            showMoreLabel={labels.showMore}
            showLessLabel={labels.showLess}
            hideCounts={hideCounts}
          />
        </FilterSection>
      )}
    </nav>
  );
}

export type FilterDrawerProps = FilterSidebarProps & {
  triggerLabel: string;
  showResultsLabel: string;
  clearAllLabel: string;
  /** Query keys clear-all removes in addition to `sub` and `material`. */
  clearAllExtraKeys?: DirectoryClearKey[];
};

export function FilterDrawer({
  triggerLabel,
  showResultsLabel,
  clearAllLabel,
  clearAllExtraKeys = [],
  ...sidebarProps
}: FilterDrawerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useResultsTransition();

  function clearAll() {
    const updates: DirectoryFilterUpdates = { sub: null, material: null };
    for (const key of clearAllExtraKeys) updates[key] = null;
    startTransition(() => {
      router.replace(updateDirectoryUrl(pathname, searchParams, updates), {
        scroll: false,
      });
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
