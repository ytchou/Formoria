"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { ChevronDown, Info, Loader2, SlidersHorizontal } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import {
  trackCategoryFilterApplied,
  trackFilterCleared,
  trackPriceFilterApplied,
  trackSubcategoryFilterApplied,
  trackVerificationFilterApplied,
} from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
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
import { ToggleChip } from "@/components/ui/toggle-chip";
import type { BrandFilters } from "@/lib/types";
import {
  clearDirectoryFilters,
  updateDirectoryUrl,
} from "@/lib/directory-filter-url";
import { DirectoryFilterToken } from "./directory-filter-token";
import { SearchInput } from "./search-input";
import type { ActiveDirectoryFilter } from "./search-empty-state";
import { buildCategoryTabTarget } from "@/components/navigation/category-tab-target";

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

/**
 * One term of the closed 12-term material vocabulary.
 *
 * `value` is the zh-TW term itself — it is what `brands.material` stores and
 * what `?material=` carries — while `label` is the localized rendering. The
 * caller drops any term whose count is zero, so this list is never longer than
 * the terms a user can actually reach.
 */
type MaterialOption = {
  value: string;
  label: string;
  count: number;
};

type BrandFilterSidebarProps = {
  activeFilters?: ActiveDirectoryFilter[];
  categories: CategoryOption[];
  activeCategorySlugs?: string[];
  subcategories?: SubcategoryOption[];
  activeSubSlugs?: string[];
  materials?: MaterialOption[];
  activeMaterials?: string[];
  className?: string;
  announceSearchLoading?: boolean;
  totalCount: number;
};

type BrandFilterDrawerProps = BrandFilterSidebarProps & {
  totalCount: number;
};

const verificationOptions: VerificationFilterValue[] = [
  "all",
  "mit-verified",
  "mit-declared",
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
              "h-4 w-4 text-muted-foreground transition-transform duration-200",
              !open && "-rotate-90",
            )}
            aria-hidden="true"
          />
        </Button>
      </div>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
        style={{ transitionTimingFunction: "var(--ease-settle)" }}
      >
        <div className="overflow-hidden">
          {children}
        </div>
      </div>
    </section>
  );
}

export function BrandFilterSidebar({
  activeFilters = [],
  categories,
  activeCategorySlugs = [],
  subcategories = [],
  activeSubSlugs = [],
  materials = [],
  activeMaterials = [],
  className,
  announceSearchLoading = true,
  totalCount,
}: BrandFilterSidebarProps) {
  const locale = useLocale();
  const t = useTranslations("brands.filters");
  const verificationT = useTranslations("brands.verificationFilter");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeCategories = useMemo(
    () => new Set(activeCategorySlugs.length > 0 ? activeCategorySlugs : parseCommaParam(searchParams.get("category"))),
    [activeCategorySlugs, searchParams],
  );
  const activeVerification = (
    searchParams.get("verification") === "mit-verified" ||
    searchParams.get("verification") === "mit-declared" ||
    searchParams.get("verification") === "owned"
      ? searchParams.get("verification")
      : "all"
  ) as VerificationFilterValue;
  const activePriceRanges = useMemo(
    () => new Set(parseCommaParam(searchParams.get("price")).map(Number)),
    [searchParams],
  );
  const activeSubcategories = new Set(activeSubSlugs);
  const activeMaterialSet = useMemo(
    () =>
      new Set(
        activeMaterials.length > 0
          ? activeMaterials
          : parseCommaParam(searchParams.get("material")),
      ),
    [activeMaterials, searchParams],
  );
  const useZh = locale === "zh-TW";
  const [isPending, startTransition] = useTransition();

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

    const target = buildCategoryTabTarget({
      pathname,
      searchParams: searchParams.toString(),
      slug,
      categorySlugs: Array.from(next),
      locale,
    });
    startTransition(() => {
      const navigate = target.routerPath.split('?')[0] === pathname ? router.replace : router.push;
      navigate(target.routerPath, { scroll: false });
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

  function toggleMaterial(value: string, checked: boolean) {
    const next = new Set(activeMaterialSet);
    if (checked) next.add(value);
    else next.delete(value);

    startTransition(() => {
      router.replace(
        updateDirectoryUrl(pathname, searchParams, {
          material: next.size > 0 ? Array.from(next).join(",") : null,
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
    <SurfaceCard
      aria-busy={isPending}
      className={cn("relative overflow-hidden", className)}
      padding="none"
    >
      <div
        className="pointer-events-none absolute right-4 top-4 z-10"
        aria-hidden="true"
      >
        <Loader2
          className={cn(
            "size-4 text-muted-foreground transition-opacity",
            isPending ? "animate-spin opacity-100" : "opacity-0",
          )}
        />
      </div>
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
            announceLoading={announceSearchLoading}
          />
          <p className="type-caption">{t("brandSearchHelp")}</p>
        </section>

        <Separator />

        <FilterSection title={t("category")} defaultOpen={activeCategories.size > 0}>
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
                        const subcategoryTarget = buildCategoryTabTarget({
                          pathname,
                          searchParams: searchParams.toString(),
                          slug: category.slug,
                          categorySlugs: [category.slug],
                          subSlug: subcategoryChecked
                            ? activeSubSlugs.filter((slug) => slug !== subcategory.slug).join(',') || null
                            : Array.from(new Set([...activeSubSlugs, subcategory.slug])).join(','),
                          locale,
                        });
                        return (
                          <Link
                            key={subcategory.slug}
                            href={subcategoryTarget.routerPath}
                            prefetch={false}
                            aria-current={subcategoryChecked ? 'page' : undefined}
                            className={cn(
                              buttonVariants({ variant: 'secondary', shape: 'pill' }),
                              'min-h-12',
                              subcategoryChecked && 'border-primary bg-primary text-primary-foreground hover:border-primary hover:bg-primary hover:text-primary-foreground',
                            )}
                            data-ph-no-autocapture
                            onClick={() => {
                              if (subcategoryChecked) {
                                trackFilterCleared("single", "subcategory", subcategory.slug)
                              } else {
                                trackSubcategoryFilterApplied(
                                  subcategory.slug,
                                  category.slug,
                                  subcategory.count,
                                )
                              }
                            }}
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
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </FilterSection>

        {materials.length > 0 ? (
          <>
            <Separator />

            <FilterSection
              title={t("material")}
              defaultOpen={activeMaterialSet.size > 0}
            >
              <div className="space-y-1">
                {materials.map((material) => {
                  const checked = activeMaterialSet.has(material.value);
                  return (
                    // The visible text inside the <label> IS the accessible
                    // name of the native checkbox it wraps — no aria-label.
                    // The count rides along in that name deliberately: it is a
                    // static fact about the option, not decoration.
                    <Label
                      key={material.value}
                      className={cn(
                        filterOptionClassName,
                        checked && "bg-primary/10 font-medium text-primary",
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value: boolean) =>
                          toggleMaterial(material.value, value)
                        }
                        data-ph-no-autocapture
                      />
                      <span>{material.label}</span>
                      <span className="ml-auto type-caption text-muted-foreground">
                        {material.count}
                      </span>
                    </Label>
                  );
                })}
              </div>
            </FilterSection>
          </>
        ) : null}

        <Separator />

        <FilterSection title={t("priceRange")}>
          <div className="flex flex-wrap gap-2">
            {priceRangeOptions.map((value) => {
              const checked = activePriceRanges.has(value);
              const label = "$".repeat(value);
              return (
                <ToggleChip
                  key={value}
                  pressed={checked}
                  onPressedChange={(next) => togglePriceRange(value, next)}
                  className="min-h-12 active:animate-spring-pop"
                  data-ph-no-autocapture
                >
                  {label}
                </ToggleChip>
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
  activeCategorySlugs = [],
  subcategories = [],
  activeSubSlugs = [],
  materials = [],
  activeMaterials = [],
  announceSearchLoading = true,
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
            activeCategorySlugs={activeCategorySlugs}
            subcategories={subcategories}
            activeSubSlugs={activeSubSlugs}
            materials={materials}
            activeMaterials={activeMaterials}
            announceSearchLoading={announceSearchLoading}
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
