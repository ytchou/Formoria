"use client";

import { useId, useMemo, useState, useTransition, type ReactNode } from "react";
import { ChevronDown, Info, Loader2, SlidersHorizontal } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import {
  trackCategoryFilterApplied,
  trackFilterCleared,
  trackSubcategoryFilterApplied,
  trackVerificationFilterApplied,
} from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Radio } from "@/components/ui/radio";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetBody,
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
 * One slug of the closed 12-slug material vocabulary.
 *
 * `value` is the slug itself — it is what `brands.material` stores and what
 * `?material=` carries — while `label` is the localized rendering the caller
 * resolved from the ontology (`nameZh` / `nameEn`), not from a message
 * catalogue. The caller also drops any slug whose count is zero, so this list
 * is never longer than the slugs a user can actually reach.
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
  "mit-declared",
];
const filterOptionClassName =
  "flex min-h-12 cursor-pointer items-center gap-2 rounded-control px-2 type-body-sm transition-colors hover:bg-surface hover:text-ink";

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
  const panelId = useId();

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="min-h-12 min-w-0 flex-1 justify-between px-2 text-left"
        >
          <span className="type-body-sm font-medium text-ink">{title}</span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-ink-muted transition-transform duration-200 motion-reduce:duration-[0.01ms]",
              !open && "-rotate-90",
            )}
            aria-hidden="true"
          />
        </Button>
      </div>
      {/*
        `grid-rows-[0fr]` hides the panel visually and nothing else: its
        checkboxes stayed in the tab order and in the accessibility tree, so a
        keyboard user tabbed through invisible controls with no focus ring
        (WCAG 2.4.3, 2.4.7). `inert` is what closes both, and unlike
        `display:none` it leaves the markup in the server HTML that crawlers
        and answer engines read (DESIGN.md §6).
      */}
      <div
        id={panelId}
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows] duration-200",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
        style={{ transitionTimingFunction: "var(--ease-settle)" }}
      >
        <div className="overflow-hidden">{children}</div>
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
    () =>
      new Set(
        activeCategorySlugs.length > 0
          ? activeCategorySlugs
          : parseCommaParam(searchParams.get("category")),
      ),
    [activeCategorySlugs, searchParams],
  );
  const activeVerification = (
    searchParams.get("verification") === "mit-declared"
      ? searchParams.get("verification")
      : "all"
  ) as VerificationFilterValue;
  const activeSubcategories = new Set(activeSubSlugs);
  // The server-validated list, and only that: `parseDirectoryViewFilters`
  // drops any value outside the closed 12-slug vocabulary, so reading
  // `?material=` back here resurrected exactly the slugs it rejected. On
  // `/brands?material=xyz` that made ticking a box re-emit `xyz`, and unticking
  // rewrite the key instead of deleting it — the facet could not be cleared at
  // all, and the page stayed noindex with a self-canonical to the junk URL.
  const activeMaterialSet = useMemo(
    () => new Set(activeMaterials),
    [activeMaterials],
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
      const navigate =
        target.routerPath.split("?")[0] === pathname
          ? router.replace
          : router.push;
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
            "size-4 text-ink-muted transition-opacity",
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
            <h2 className="type-body-sm font-medium text-inherit">
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
          <p className="type-metadata text-inherit/80">{t("appliedHint")}</p>
        </section>
      ) : null}

      <div className="space-y-6 p-4">
        <section className="space-y-3">
          <div className="flex items-center gap-1.5">
            <h2 className="type-body-sm font-medium text-ink">
              {t("brandSearch")}
            </h2>
            <Info className="size-4 text-ink-muted" aria-hidden="true" />
          </div>
          <SearchInput
            className="max-w-none"
            formAriaLabel={t("brandSearchLandmark")}
            showAutocomplete={false}
            announceLoading={announceSearchLoading}
          />
          <p className="type-metadata">{t("brandSearchHelp")}</p>
        </section>

        <Separator />

        <FilterSection
          title={t("category")}
          defaultOpen={activeCategories.size > 0}
        >
          <div className="space-y-1">
            {categories.map((category) => {
              const checked = activeCategories.has(category.slug);
              return (
                <div key={category.slug} className="space-y-2">
                  <Label
                    className={cn(
                      filterOptionClassName,
                      checked && "bg-accent/10 font-medium text-accent",
                    )}
                  >
                    {/*
                      No `aria-label`: the visible text inside this <label> is
                      already the checkbox's accessible name, and an aria-label
                      would outrank it — the same rule the material block below
                      documents. The count span is `aria-hidden`, so the name
                      stays the bare category label.
                    */}
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value: boolean) =>
                        toggleCategory(category.slug, value)
                      }
                      data-ph-no-autocapture
                    />
                    <span>{categoryLabel(category)}</span>
                    {/*
                      Only while the L1 is what narrows the page. With an L2
                      active the brand query drops the L1 entirely, so this
                      count belongs to the subcategory and printing it beside
                      the category name states a total the L1 never produced.
                    */}
                    {checked &&
                      activeCategories.size === 1 &&
                      activeSubSlugs.length === 0 && (
                        <span
                          className="ml-auto type-metadata text-inherit"
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
                            ? activeSubSlugs
                                .filter((slug) => slug !== subcategory.slug)
                                .join(",") || null
                            : Array.from(
                                new Set([...activeSubSlugs, subcategory.slug]),
                              ).join(","),
                          locale,
                        });
                        return (
                          <Link
                            key={subcategory.slug}
                            href={subcategoryTarget.routerPath}
                            prefetch={false}
                            aria-current={
                              subcategoryChecked ? "page" : undefined
                            }
                            className={cn(
                              buttonVariants({
                                variant: "secondary",
                                shape: "pill",
                              }),
                              "min-h-12",
                              subcategoryChecked &&
                                "border-accent bg-accent text-ground hover:border-accent hover:bg-accent hover:text-ground",
                            )}
                            data-ph-no-autocapture
                            onClick={() => {
                              if (subcategoryChecked) {
                                trackFilterCleared(
                                  "single",
                                  "subcategory",
                                  subcategory.slug,
                                );
                              } else {
                                trackSubcategoryFilterApplied(
                                  subcategory.slug,
                                  category.slug,
                                  subcategory.count,
                                );
                              }
                            }}
                          >
                            {subcategory.label}{" "}
                            <span
                              className={cn(
                                subcategoryChecked
                                  ? "text-ground/70"
                                  : "text-ink-muted",
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
                        checked && "bg-accent/10 font-medium text-accent",
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
                      <span className="ml-auto type-metadata text-ink-muted">
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
        checked && "bg-accent/10 font-medium text-accent",
      )}
    >
      <Radio
        name={name}
        checked={checked}
        onChange={onChange}
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
          <Button
            variant="secondary"
            size="large"
            className="gap-2 lg:hidden"
          />
        }
      >
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        {t("trigger", { count: activeFilters.length })}
      </SheetTrigger>
      <SheetContent
        side="left"
        size="panel"
        className="gap-0 p-0"
        showCloseButton
      >
        <SheetHeader className="border-b border-rule">
          <SheetTitle>{t("title")}</SheetTitle>
        </SheetHeader>
        {/*
          The drawer's ONE scroll container. The footer below is pinned by the
          popup's own flex column — `SheetBody` takes `flex-1` and the footer
          takes `mt-auto` — not by `sticky bottom-0`, which needed this body to
          be the scrollport of a taller box and drew the footer over the last
          filter row when it wasn't.
        */}
        <SheetBody>
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
        </SheetBody>
        <SheetFooter>
          <Button type="button" width="full" onClick={() => setOpen(false)}>
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
      size="large"
      onClick={clearAll}
      className="mx-auto type-body-sm underline-offset-2 hover:text-ink hover:underline"
      data-ph-no-autocapture
    >
      {t("clearAll")}
    </Button>
  );
}
