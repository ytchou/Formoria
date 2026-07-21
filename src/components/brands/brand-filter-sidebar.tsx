"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { ChevronDown, Info, SlidersHorizontal } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  trackCategoryFilterApplied,
  trackFilterCleared,
  trackPriceFilterApplied,
  trackSubcategoryFilterApplied,
  trackVerificationFilterApplied,
} from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { BrandFilters } from "@/lib/types";
import {
  clearDirectoryFilters,
  updateDirectoryUrl,
} from "@/lib/directory-filter-url";
import { DirectoryFilterToken } from "./directory-filter-token";
import { SearchInput } from "./search-input";
import type { ActiveDirectoryFilter } from "./search-empty-state";

type VerificationFilterValue = NonNullable<BrandFilters["verificationFilter"]>;

type CategoryOption = {
  slug: string;
  name: string;
  nameZh: string | null;
};

type SubcategoryOption = {
  slug: string;
  label: string;
  count: number;
};

type BrandFilterSidebarProps = {
  activeFilters?: ActiveDirectoryFilter[];
  categories: CategoryOption[];
  subcategories?: SubcategoryOption[];
  activeSubSlugs?: string[];
  className?: string;
  totalCount: number;
};

type BrandFilterDrawerProps = BrandFilterSidebarProps & {
  totalCount: number;
};

const verificationOptions: VerificationFilterValue[] = [
  "all",
  "mit-verified",
  "owned",
];
const priceRangeOptions = [1, 2, 3] as const;
const filterOptionClassName =
  "flex min-h-12 cursor-pointer items-center gap-2 rounded-lg px-2 type-card-description transition-colors hover:bg-muted hover:text-foreground";

function parseCommaParam(value: string | null): string[] {
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function FilterSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="min-h-12 min-w-0 flex-1 justify-between px-2 text-left"
        >
          <span className="type-body-emphasis">{title}</span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              !open && "-rotate-90",
            )}
            aria-hidden="true"
          />
        </Button>
      </div>
      {open && children}
    </section>
  );
}

export function BrandFilterSidebar({
  activeFilters = [],
  categories,
  subcategories = [],
  activeSubSlugs = [],
  className,
  totalCount,
}: BrandFilterSidebarProps) {
  const locale = useLocale();
  const t = useTranslations("brands.filters");
  const verificationT = useTranslations("brands.verificationFilter");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeCategories = useMemo(
    () => new Set(parseCommaParam(searchParams.get("category"))),
    [searchParams],
  );
  const activeVerification = (
    searchParams.get("verification") === "mit-verified" ||
    searchParams.get("verification") === "owned"
      ? searchParams.get("verification")
      : "all"
  ) as VerificationFilterValue;
  const activePriceRanges = useMemo(
    () => new Set(parseCommaParam(searchParams.get("price")).map(Number)),
    [searchParams],
  );
  const activeSubcategories = new Set(activeSubSlugs);
  const useZh = locale === "zh-TW";
  const [, startTransition] = useTransition();

  function categoryLabel(category: CategoryOption) {
    return useZh ? (category.nameZh ?? category.name) : category.name;
  }

  function toggleCategory(slug: string, checked: boolean) {
    const next = new Set(activeCategories);
    if (checked) {
      next.add(slug);
      trackCategoryFilterApplied(slug);
    } else {
      next.delete(slug);
    }

    startTransition(() => {
      router.replace(
        updateDirectoryUrl(pathname, searchParams, {
          category: next.size > 0 ? Array.from(next).join(",") : null,
          ...(!checked || next.size > 1 ? { sub: null } : {}),
        }),
        { scroll: false },
      );
    });
  }

  function toggleSubcategory(
    slug: string,
    checked: boolean,
    parentCategorySlug: string,
  ) {
    const next = new Set(activeSubcategories);
    if (checked) {
      next.add(slug);
      trackSubcategoryFilterApplied(slug, parentCategorySlug);
    } else {
      next.delete(slug);
      trackFilterCleared("single", "subcategory", slug);
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

  function setVerification(value: VerificationFilterValue) {
    trackVerificationFilterApplied(value);
    startTransition(() => {
      router.replace(
        updateDirectoryUrl(pathname, searchParams, {
          verification: value === "all" ? null : value,
        }),
        { scroll: false },
      );
    });
  }

  function togglePriceRange(value: number, checked: boolean) {
    const next = new Set(activePriceRanges);
    if (checked) {
      next.add(value);
      trackPriceFilterApplied(String(value));
    } else {
      next.delete(value);
      trackFilterCleared("single", "price", String(value));
    }

    startTransition(() => {
      router.replace(
        updateDirectoryUrl(pathname, searchParams, {
          price: next.size > 0 ? Array.from(next).sort().join(",") : null,
        }),
        { scroll: false },
      );
    });
  }

  return (
    <SurfaceCard className={cn("overflow-hidden", className)} padding="none">
      {activeFilters.length > 0 ? (
        <section
          aria-label={t("currentConditions")}
          className="space-y-3 bg-filter-active-bg px-4 py-4 text-filter-active"
        >
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="size-5 shrink-0" aria-hidden="true" />
            <h2 className="type-body-emphasis text-inherit">
              {t("currentConditions")}
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {activeFilters.map((filter) => (
              <DirectoryFilterToken
                key={filter.id}
                href={filter.removeHref}
                label={filter.label}
                removeLabel={filter.removeLabel}
                value={filter.value}
                variant="chip"
              />
            ))}
          </div>
          <p className="type-caption text-inherit/80">{t("appliedHint")}</p>
        </section>
      ) : null}

      <div className="space-y-6 p-4">
        <section className="space-y-3">
          <div className="flex items-center gap-1.5">
            <h2 className="type-body-emphasis">{t("brandSearch")}</h2>
            <Info className="size-4 text-muted-foreground" aria-hidden="true" />
          </div>
          <SearchInput
            className="max-w-none"
            formAriaLabel={t("brandSearchLandmark")}
            showAutocomplete={false}
          />
          <p className="type-caption">{t("brandSearchHelp")}</p>
        </section>

        <Separator />

        <FilterSection title={t("category")}>
          <div className="space-y-1">
            {categories.map((category) => {
              const checked = activeCategories.has(category.slug);
              return (
                <div key={category.slug} className="space-y-2">
                  <Label
                    className={cn(
                      filterOptionClassName,
                      checked && "bg-primary/10 font-medium text-primary",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value: boolean) =>
                        toggleCategory(category.slug, value)
                      }
                      aria-label={categoryLabel(category)}
                      data-ph-no-autocapture
                    />
                    <span>{categoryLabel(category)}</span>
                    {checked && activeCategories.size === 1 && (
                      <span
                        className="ml-auto type-caption text-inherit"
                        aria-hidden="true"
                      >
                        {totalCount}
                      </span>
                    )}
                  </Label>
                  {checked && subcategories.length > 0 && (
                    <div className="ml-6 flex flex-wrap gap-2">
                      {subcategories.map((subcategory) => {
                        const subcategoryChecked = activeSubcategories.has(
                          subcategory.slug,
                        );
                        return (
                          <Button
                            key={subcategory.slug}
                            type="button"
                            variant="secondary"
                            shape="pill"
                            aria-pressed={subcategoryChecked}
                            onClick={() =>
                              toggleSubcategory(
                                subcategory.slug,
                                !subcategoryChecked,
                                category.slug,
                              )
                            }
                            className={cn(
                              "min-h-12",
                              subcategoryChecked &&
                                "border-primary bg-primary text-primary-foreground",
                            )}
                            data-ph-no-autocapture
                          >
                            {subcategory.label}{" "}
                            <span
                              className={cn(
                                subcategoryChecked
                                  ? "text-primary-foreground/70"
                                  : "text-muted-foreground",
                              )}
                            >
                              {subcategory.count}
                            </span>
                          </Button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </FilterSection>

        <Separator />

        <FilterSection title={t("priceRange")}>
          <div className="flex flex-wrap gap-2">
            {priceRangeOptions.map((value) => {
              const checked = activePriceRanges.has(value);
              const label = "$".repeat(value);
              return (
                <Button
                  key={value}
                  type="button"
                  variant="secondary"
                  shape="pill"
                  aria-pressed={checked}
                  onClick={() => togglePriceRange(value, !checked)}
                  className={cn(
                    "min-h-12",
                    checked &&
                      "border-primary bg-primary text-primary-foreground",
                  )}
                  data-ph-no-autocapture
                >
                  {label}
                </Button>
              );
            })}
          </div>
        </FilterSection>

        <Separator />

        <FilterSection title={t("brandStatus")}>
          <div
            role="radiogroup"
            aria-label={t("brandStatus")}
            className="space-y-1"
          >
            {verificationOptions.map((value) => (
              <FilterRadio
                key={value}
                name="brand-verification"
                checked={activeVerification === value}
                label={verificationT(value)}
                onChange={() => setVerification(value)}
              />
            ))}
          </div>
        </FilterSection>
      </div>
    </SurfaceCard>
  );
}

function FilterRadio({
  name,
  checked,
  label,
  onChange,
}: {
  name: string;
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <Label
      className={cn(
        filterOptionClassName,
        checked && "bg-primary/10 font-medium text-primary",
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 accent-primary"
        data-ph-no-autocapture
      />
      <span>{label}</span>
    </Label>
  );
}

export function BrandFilterDrawer({
  activeFilters = [],
  categories,
  subcategories = [],
  activeSubSlugs = [],
  totalCount,
}: BrandFilterDrawerProps) {
  const [open, setOpen] = useState(false);
  const t = useTranslations("brands.filters");

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="secondary" className="min-h-12 gap-2 lg:hidden" />
        }
      >
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        {t("trigger", { count: activeFilters.length })}
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-[86vw] max-w-sm gap-0 p-0"
        showCloseButton
      >
        <SheetHeader className="border-b border-border">
          <SheetTitle>{t("title")}</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <BrandFilterSidebar
            activeFilters={activeFilters}
            categories={categories}
            subcategories={subcategories}
            activeSubSlugs={activeSubSlugs}
            totalCount={totalCount}
          />
        </div>
        <SheetFooter className="sticky bottom-0 border-t border-border bg-popover">
          <Button
            type="button"
            className="w-full"
            onClick={() => setOpen(false)}
          >
            {t("showResults", { count: totalCount })}
          </Button>
          <MobileClearAll onClear={() => setOpen(false)} />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function MobileClearAll({ onClear }: { onClear: () => void }) {
  const t = useTranslations("brands.filters");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function clearAll() {
    trackFilterCleared("all");
    startTransition(() => {
      router.replace(
        clearDirectoryFilters(pathname, searchParams, { includeSearch: true }),
        { scroll: false },
      );
    });
    onClear();
  }

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={clearAll}
      className="mx-auto min-h-12 type-card-description underline-offset-2 hover:text-foreground hover:underline"
      data-ph-no-autocapture
    >
      {t("clearAll")}
    </Button>
  );
}
