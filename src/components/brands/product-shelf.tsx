"use client";

import { useCallback, useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { ChipSwapFade } from "@/components/motion/chip-swap-fade";
import { Button } from "@/components/ui/button";
import { CARD_GRID_COLUMNS } from "@/components/ui/grid";
import { ChipRow, ToggleChip } from "@/components/ui/toggle-chip";
import { Typography } from "@/components/ui/typography";
import type { AppLocale } from "@/i18n/locale-preference";
import type { BrandVisitLinkFields } from "@/lib/brands/link-fallback";
import type { ProductRailGroup } from "@/lib/curated-products/brand-rails";
import { subcategoryDisplayLabel } from "@/lib/taxonomy/ontology";
import { cn } from "@/lib/utils";
import {
  SelectedProductTile,
  type SelectedProductTileGuide,
  type SelectedProductTileLabels,
} from "./selected-product-tile";

/**
 * At or below this many products the shelf is a static grid (BD2-11): a
 * carousel of one to three cards is all chrome and no browsing.
 */
const STATIC_SHELF_MAX = 3;

export type ProductShelfProps = {
  groups: ProductRailGroup[];
  allLabel: string;
  labels: SelectedProductTileLabels;
  locale: AppLocale;
  brand: BrandVisitLinkFields & { slug: string };
  heading: string;
  note: string;
  ariaLabel: string;
  previousLabel: string;
  nextLabel: string;
  /** Product key → the published guide that placed it (CP2-15). */
  guides?: Record<string, SelectedProductTileGuide>;
};

export function ProductShelf({
  groups,
  allLabel,
  labels,
  locale,
  brand,
  heading,
  note,
  ariaLabel,
  previousLabel,
  nextLabel,
  guides = {},
}: ProductShelfProps) {
  const [activeSubcategory, setActiveSubcategory] = useState<string | null>(
    null,
  );
  // Products whose photo failed to load (BD2-06). They leave the shelf rather
  // than leave an empty, broken image behind.
  const [failedKeys, setFailedKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const markFailed = useCallback((key: string) => {
    setFailedKeys((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);

  const visibleGroups = groups
    .map((g) => ({
      ...g,
      products: g.products.filter((p) => !failedKeys.has(p.key)),
    }))
    .filter((g) => g.products.length > 0);
  const totalCount = visibleGroups.reduce(
    (sum, g) => sum + g.products.length,
    0,
  );
  const isCarousel = totalCount > STATIC_SHELF_MAX;
  // A chip whose every photo failed is gone; its filter falls back to all.
  const activeGroup = visibleGroups.find(
    (g) => g.subcategory === activeSubcategory,
  );
  const activeKey = activeGroup ? activeGroup.subcategory : null;

  const filteredProducts = activeGroup
    ? activeGroup.products
    : visibleGroups.flatMap((g) => g.products);

  const [viewportRef, emblaApi] = useEmblaCarousel({
    align: "start",
    containScroll: "trimSnaps",
  });

  const [canScroll, setCanScroll] = useState(false);

  const sync = useCallback(() => {
    if (!emblaApi) return;
    setCanScroll(emblaApi.canScrollPrev() || emblaApi.canScrollNext());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    const frame = requestAnimationFrame(sync);
    emblaApi.on("reInit", sync).on("select", sync);
    return () => {
      cancelAnimationFrame(frame);
      emblaApi.off("reInit", sync).off("select", sync);
    };
  }, [emblaApi, sync]);

  // Reset scroll position when filter changes.
  useEffect(() => {
    emblaApi?.scrollTo(0);
  }, [activeSubcategory, emblaApi]);

  const tiles = filteredProducts.map((product) => (
    <SelectedProductTile
      key={product.key}
      locale={locale}
      product={product}
      labels={labels}
      mode="shelf"
      brand={brand}
      guide={guides[product.key]}
      onImageError={() => markFailed(product.key)}
    />
  ));

  return (
    <div
      role="region"
      // A static grid is a list, not a carousel; only the carousel says so.
      aria-roledescription={isCarousel ? "carousel" : undefined}
      aria-label={ariaLabel}
      className="space-y-stack"
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          {/* No section-level 選物 label: a tile carries it, with its guide,
              only where there is a reason (CP2-15). `balance` + the base h2
              rule's `word-break: auto-phrase` keep CJK phrases whole. */}
          <Typography as="h2" variant="sectionTitleLarge" balance>
            {heading}
          </Typography>
          {isCarousel && canScroll ? (
            // Phones swipe; the arrows start at `sm` (BD2-14).
            <div className="hidden shrink-0 gap-2 sm:flex">
              <Button
                type="button"
                variant="secondary"
                shape="pill"
                size="icon"
                aria-label={previousLabel}
                onClick={() => emblaApi?.scrollPrev()}
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="secondary"
                shape="pill"
                size="icon"
                aria-label={nextLabel}
                onClick={() => emblaApi?.scrollNext()}
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          ) : null}
        </div>
        <Typography as="p" variant="cardDescription">
          {note}
        </Typography>
      </div>

      {/* One subcategory needs no filter. */}
      {visibleGroups.length >= 2 ? (
        <ChipRow>
          <ToggleChip
            pressed={activeKey === null}
            onPressedChange={() => setActiveSubcategory(null)}
          >
            {allLabel}
          </ToggleChip>
          {visibleGroups.map((group) => (
            <ToggleChip
              key={group.subcategory}
              pressed={activeKey === group.subcategory}
              onPressedChange={() => setActiveSubcategory(group.subcategory)}
            >
              {subcategoryDisplayLabel(group.subcategory, locale)}
            </ToggleChip>
          ))}
        </ChipRow>
      ) : null}

      {totalCount === 0 ? null : (
        <ChipSwapFade swapKey={activeKey ?? "all"} itemSelector="ul > li">
          {isCarousel ? (
            // The peek bleeds to the viewport edge (BD2-13): the viewport runs
            // out through the inline-end page gutter (`page-gutter-wide`'s
            // three steps) and pads the same amount back. Its edge lands on
            // the shell's edge, so the page gains no horizontal scroll.
            <div
              ref={viewportRef}
              className="-me-6 overflow-hidden pe-6 md:-me-10 md:pe-10 xl:-me-16 xl:pe-16"
            >
              <ul className="-ml-4 flex list-none p-0 [&>li]:min-w-0 [&>li]:flex-none [&>li]:basis-[80%] [&>li]:pl-4 sm:[&>li]:basis-[45%] lg:[&>li]:basis-[23%]">
                {tiles}
              </ul>
            </div>
          ) : (
            <ul
              className={cn("grid list-none gap-gutter p-0", CARD_GRID_COLUMNS)}
            >
              {tiles}
            </ul>
          )}
        </ChipSwapFade>
      )}
    </div>
  );
}
