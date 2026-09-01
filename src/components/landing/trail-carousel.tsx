"use client";

import { useCallback, useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { Link } from "@/i18n/navigation";
import { SurfaceImage } from "@/components/ui/image";
import { safeImageSrc } from "@/lib/images/allowed-image-hosts";
import { routes } from "@/lib/routes";
import { trackTrailCardClicked } from "@/lib/analytics";
import type { TrailEntry } from "@/lib/services/trails";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type TrailCarouselProps = {
  trails: TrailEntry[];
  labels: { eyebrow: string; cta: string; prev: string; next: string };
};

/**
 * Scale/opacity classes by distance from the active slide. The transforms go
 * on the INNER wrapper div — Embla uses transforms on the slide div itself, so
 * applying scale there would conflict.
 *
 * `prefers-reduced-motion` is respected via a CSS media query: transitions are
 * disabled and all slides render at full opacity/scale.
 */
const DISTANCE_CLASSES: Record<number, string> = {
  0: "scale-100 opacity-100",
  1: "scale-[0.85] opacity-75",
};
const FAR_CLASSES = "scale-[0.75] opacity-50";

function distanceClasses(distance: number): string {
  return DISTANCE_CLASSES[distance] ?? FAR_CLASSES;
}

export default function TrailCarousel({ trails, labels }: TrailCarouselProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: "center",
    loop: true,
    containScroll: false,
  });

  const [activeIndex, setActiveIndex] = useState(0);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setActiveIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.on("select", onSelect);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- embla requires syncing initial state on mount
    onSelect();
    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi, onSelect]);

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);

  const total = trails.length;

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label={labels.eyebrow}
      className="relative"
    >
      {/* Viewport */}
      <div ref={emblaRef} className="overflow-hidden">
        <div className="flex">
          {trails.map((trail, index) => {
            const distance = Math.min(
              Math.abs(index - activeIndex),
              total - Math.abs(index - activeIndex),
            );
            const heroSrc = safeImageSrc(trail.frontmatter.heroImage);

            return (
              <div
                key={trail.slug}
                role="group"
                aria-roledescription="slide"
                aria-label={`${index + 1} / ${total}`}
                className="min-w-0 flex-none basis-[85%] px-3 sm:basis-[70%] md:basis-[55%] lg:basis-[45%]"
              >
                {/* Inner wrapper carries the scale/opacity transforms —
                    never on the Embla slide div itself. */}
                <div
                  className={cn(
                    "transition-[transform,opacity] duration-300",
                    "motion-reduce:transition-none motion-reduce:scale-100 motion-reduce:opacity-100",
                    distanceClasses(distance),
                  )}
                >
                  <Link
                    href={routes.trail(trail.slug)}
                    className="group block overflow-hidden rounded-surface focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ground"
                    onClick={() =>
                      trackTrailCardClicked(
                        trail.slug,
                        index,
                        "landing_carousel",
                      )
                    }
                  >
                    {/* Image */}
                    <div className="relative aspect-[3/2] overflow-hidden rounded-surface bg-surface">
                      {heroSrc ? (
                        <SurfaceImage
                          src={heroSrc}
                          alt={
                            trail.frontmatter.heroImageAlt ??
                            trail.frontmatter.title
                          }
                          fill
                          surface="card"
                          className="object-cover"
                        />
                      ) : (
                        <div className="absolute inset-0 bg-surface" />
                      )}
                      {/* Eyebrow badge */}
                      <span className="absolute left-3 top-3 rounded-control bg-ground/80 px-2 py-1 type-eyebrow backdrop-blur-sm">
                        {labels.eyebrow}
                      </span>
                    </div>

                    {/* Text */}
                    <div className="mt-3 space-y-1">
                      <h3 className="font-ming type-card-title line-clamp-2">
                        {trail.frontmatter.title}
                      </h3>
                      {trail.frontmatter.promise && (
                        <p className="type-body-sm text-ink-muted line-clamp-2">
                          {trail.frontmatter.promise}
                        </p>
                      )}
                    </div>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Prev / Next buttons — 44x44 touch target */}
      <Button
        variant="ghost"
        size="icon"
        shape="pill"
        aria-label={labels.prev}
        onClick={scrollPrev}
        className="absolute left-2 top-1/2 z-10 -translate-y-1/2 bg-ground/80 backdrop-blur-sm"
      >
        <span aria-hidden="true">&#8249;</span>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        shape="pill"
        aria-label={labels.next}
        onClick={scrollNext}
        className="absolute right-2 top-1/2 z-10 -translate-y-1/2 bg-ground/80 backdrop-blur-sm"
      >
        <span aria-hidden="true">&#8250;</span>
      </Button>

      {/* Pagination dots */}
      <div className="mt-4 flex items-center justify-center gap-2">
        {trails.map((trail, index) => (
          <span
            key={trail.slug}
            data-dot
            className={cn(
              "block h-2 w-2 rounded-full transition-colors duration-300",
              "motion-reduce:transition-none",
              index === activeIndex ? "bg-accent" : "bg-ink-muted/40",
            )}
          />
        ))}
      </div>
    </div>
  );
}
