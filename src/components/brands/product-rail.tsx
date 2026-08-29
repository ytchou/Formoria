"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

export function ProductRail({
  ariaLabel,
  previousLabel,
  nextLabel,
  children,
}: {
  ariaLabel: string;
  previousLabel: string;
  nextLabel: string;
  children: ReactNode;
}) {
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

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label={ariaLabel}
      className="relative"
    >
      <div ref={viewportRef} className="overflow-hidden">
        <ul className="-ml-4 flex list-none p-0 [&>li]:min-w-0 [&>li]:flex-none [&>li]:basis-full [&>li]:pl-4 sm:[&>li]:basis-1/2 lg:[&>li]:basis-1/3">
          {children}
        </ul>
      </div>
      {canScroll ? (
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            shape="pill"
            size="large"
            aria-label={previousLabel}
            onClick={() => emblaApi?.scrollPrev()}
            className="w-12 px-0"
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            shape="pill"
            size="large"
            aria-label={nextLabel}
            onClick={() => emblaApi?.scrollNext()}
            className="w-12 px-0"
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
