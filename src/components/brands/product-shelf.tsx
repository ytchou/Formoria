"use client";

import { useCallback, useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ChipRow, ToggleChip } from "@/components/ui/toggle-chip";
import { Typography } from "@/components/ui/typography";
import type { AppLocale } from "@/i18n/locale-preference";
import type { BrandVisitLinkFields } from "@/lib/brands/link-fallback";
import type { ProductRailGroup } from "@/lib/curated-products/brand-rails";
import { subcategoryDisplayLabel } from "@/lib/taxonomy/ontology";
import {
  SelectedProductTile,
  type SelectedProductTileLabels,
} from "./selected-product-tile";

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
}: ProductShelfProps) {
  const [activeSubcategory, setActiveSubcategory] = useState<string | null>(
    null,
  );

  const filteredProducts =
    activeSubcategory === null
      ? groups.flatMap((g) => g.products)
      : (groups.find((g) => g.subcategory === activeSubcategory)?.products ??
        []);

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

  return (
    <div className="space-y-stack">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <Typography as="h2" variant="sectionTitleLarge">
            {heading}
          </Typography>
          {canScroll ? (
            <div className="flex shrink-0 gap-2">
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

      <ChipRow>
        <ToggleChip
          pressed={activeSubcategory === null}
          onPressedChange={() => setActiveSubcategory(null)}
        >
          {allLabel}
        </ToggleChip>
        {groups.map((group) => (
          <ToggleChip
            key={group.subcategory}
            pressed={activeSubcategory === group.subcategory}
            onPressedChange={() => setActiveSubcategory(group.subcategory)}
          >
            {subcategoryDisplayLabel(group.subcategory, locale)}
          </ToggleChip>
        ))}
      </ChipRow>

      <div role="region" aria-roledescription="carousel" aria-label={ariaLabel}>
        <div ref={viewportRef} className="overflow-hidden">
          <ul className="-ml-4 flex list-none p-0 [&>li]:min-w-0 [&>li]:flex-none [&>li]:basis-[80%] [&>li]:pl-4 sm:[&>li]:basis-[45%] lg:[&>li]:basis-[23%]">
            {filteredProducts.map((product) => (
              <SelectedProductTile
                key={product.key}
                locale={locale}
                product={product}
                labels={labels}
                mode="shelf"
                brand={brand}
              />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
