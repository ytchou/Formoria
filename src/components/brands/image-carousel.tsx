"use client";

import { useState, useRef } from "react";
import { SurfaceImage } from "@/components/ui/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { safeImageSrc } from "@/lib/images/allowed-image-hosts";
import { brandImageFill } from "@/lib/images/fill";
import type { BrandImageMeta } from "@/lib/types/brand";
import { trackGalleryPhotoView, trackGalleryCompleted } from "@/lib/analytics";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BrandImageFallback } from "./brand-image-fallback";
import { useBrandEngagement } from "./brand-engagement-tracker";

interface ImageCarouselProps {
  images: string[];
  alt: string;
  brandId: string;
  brandSlug: string;
  category?: string | null;
  imageAlts?: BrandImageMeta[];
  variant?: "detail" | "compact";
  trackingEnabled?: boolean;
}

export function ImageCarousel({
  images,
  alt,
  brandId,
  brandSlug,
  category,
  imageAlts,
  variant = "detail",
  trackingEnabled = true,
}: ImageCarouselProps) {
  const t = useTranslations("brandDetail");
  const { reportEngagement } = useBrandEngagement();
  // The source index rides along because `imageAlts` is index-aligned with the
  // unfiltered `images` prop: dropping an unsafe URL shifts every later
  // position, which silently handed the wrong alt (and now the wrong fill mode)
  // to every image after it.
  const validImages = images.flatMap((image, sourceIndex) => {
    const safeSrc = safeImageSrc(image);
    return safeSrc ? [{ src: safeSrc, sourceIndex }] : [];
  });
  const [current, setCurrent] = useState(0);
  const [previous, setPrevious] = useState<number | null>(null);
  const [brokenImages, setBrokenImages] = useState<Set<number>>(new Set());
  const total = validImages.length;
  const viewedIndices = useRef(new Set<number>([0]));
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const completedFired = useRef(false);

  const initial = [...alt][0];

  if (total === 0) {
    return (
      <div
        // ONE ratio for both variants. It used to be 4:3 on detail and square
        // in the grid, so the same photo was cropped two different ways
        // depending on where you looked at it. `aspect-media` is 1:1 — see the
        // token's comment in globals.css for the measurement.
        className="relative mx-auto aspect-media max-w-[70svh] overflow-hidden rounded-surface bg-surface-deep xl:max-w-none"
      >
        <BrandImageFallback
          name={alt}
          category={category ?? null}
          size="detail"
        />
      </div>
    );
  }

  // Returns undefined for an out-of-range index rather than guessing. There is
  // no honest fallback: `imageAlts` is index-aligned with the UNFILTERED
  // `images` prop, so substituting the display index would hand back another
  // image's alt text and fill mode — the exact desync `sourceIndex` exists to
  // prevent. (The previous `?? index` fallback was unreachable while in range
  // and wrong out of it.)
  function metaFor(index: number): BrandImageMeta | undefined {
    const sourceIndex = validImages[index]?.sourceIndex;
    return sourceIndex === undefined ? undefined : imageAlts?.[sourceIndex];
  }

  function getAlt(index: number): string {
    return (
      metaFor(index)?.altZh ??
      t("gallery.photoAltWithBrand", { brand: alt, n: index + 1 })
    );
  }

  // Shared with every other brand image surface. The container already paints
  // the `bg-surface-deep` plate a contained logo sits on, so no `logoPlate`
  // here.
  function fill(index: number, inset: string) {
    return brandImageFill(metaFor(index), { inset });
  }

  const heroInset = variant === "detail" ? "p-6" : "p-3";

  function handleImageError(index: number) {
    setBrokenImages((prev) => new Set(prev).add(index));
  }

  function goTo(index: number) {
    const next = ((index % total) + total) % total;
    if (next === current) return;
    clearTimeout(fadeTimerRef.current);
    setPrevious(current);
    setCurrent(next);
    viewedIndices.current.add(next);
    if (trackingEnabled) {
      trackGalleryPhotoView(brandSlug, next, brandId);
      reportEngagement("gallery");
      if (!completedFired.current && viewedIndices.current.size >= total) {
        completedFired.current = true;
        trackGalleryCompleted(brandId, brandSlug, total);
      }
    }
    fadeTimerRef.current = setTimeout(() => setPrevious(null), 200);
  }

  const isCurrentBroken = brokenImages.has(current);
  /*
   * Bounds-guarded, not indexed directly.
   *
   * `current` and `previous` are `useState` indices while `validImages` is
   * recomputed from props on every render, so a prop change that shortens the
   * list leaves them pointing past the end. Reading `.src` off `undefined`
   * throws and takes the page down; on `main` the same expression merely passed
   * `undefined` through. A missing current image falls back to the same
   * placeholder a broken one gets, and a missing previous image simply skips
   * the cross-fade.
   */
  const currentImage = validImages[current];
  const previousImage =
    previous !== null && !brokenImages.has(previous)
      ? validImages[previous]
      : undefined;
  // The hero CONTAINS rather than covers: both consumers of this carousel show
  // one product large (brand detail, dashboard hero card), so nothing neighbours
  // the image and there is no ragged-strip problem to solve — cropping would
  // only remove product. The thumbnails below still cover; they are small
  // indicative tiles where a uniform strip reads better than a row of
  // letterboxes. See DEV-1407.
  const currentFill = brandImageFill(metaFor(current), {
    inset: heroInset,
    fit: "contain",
  });
  const previousFill = brandImageFill(
    previous === null ? undefined : metaFor(previous),
    {
      inset: heroInset,
      fit: "contain",
    },
  );
  /*
   * The brand-supplied credit — a credit, not a badge.
   *
   * It states where ONE file came from, so it sits under that file and moves
   * with it; a badge would put it in the same register as the selection
   * label, which is an
   * editorial commitment Formoria makes rather than a fact about provenance.
   *
   * Read off `metaFor(current)`, which resolves through `sourceIndex` — the
   * same discipline alt text and fill mode use. Indexing the FILTERED list here
   * would credit the brand for a photograph it never supplied, which is the one
   * way this line can be actively wrong rather than merely absent.
   *
   * Absent is the common case and is correct: a brand with no owner uploads has
   * nothing to credit. There is no fallback.
   */
  const isCurrentBrandSupplied = metaFor(current)?.isOwnerSupplied === true;
  const hasDetailGallery = total > 1 && variant === "detail";

  return (
    <div
      className={cn(
        variant === "detail" && "space-y-3",
        hasDetailGallery &&
          "xl:grid xl:grid-cols-[4.5rem_minmax(0,1fr)] xl:items-start xl:gap-3 xl:space-y-0",
      )}
    >
      {/* Hero image */}
      <div
        // ONE ratio for both variants. It used to be 4:3 on detail and square
        // in the grid, so the same photo was cropped two different ways
        // depending on where you looked at it. `aspect-media` is 1:1 — see the
        // token's comment in globals.css for the measurement.
        className={cn(
          "relative mx-auto aspect-media max-w-[70svh] overflow-hidden rounded-surface bg-surface-deep xl:max-w-none",
          hasDetailGallery && "xl:col-start-2 xl:row-start-1",
        )}
      >
        {previousImage && (
          <SurfaceImage
            src={previousImage.src}
            alt=""
            fill
            className={cn(
              "transition-opacity duration-200 opacity-0",
              previousFill,
            )}
            style={{
              transitionTimingFunction: "var(--ease-settle)",
            }}
            surface="card"
            // The detail hero is a single column capped at 580px; in the grid
            // variant it is a fixed 192px cell. Neither is the four-up card
            // measure the `card` surface describes, so both are stated.
            sizes={
              variant === "detail"
                ? "(max-width: 1024px) 100vw, 580px"
                : "192px"
            }
            aria-hidden
          />
        )}

        {isCurrentBroken || !currentImage ? (
          <BrandImageFallback
            name={alt}
            category={category ?? null}
            size="detail"
          />
        ) : (
          <SurfaceImage
            key={current}
            src={currentImage.src}
            alt={getAlt(current)}
            fill
            className={cn(
              previous !== null && "animate-in fade-in duration-200",
              currentFill,
            )}
            surface="card"
            // The detail hero is a single column capped at 580px; in the grid
            // variant it is a fixed 192px cell. Neither is the four-up card
            // measure the `card` surface describes, so both are stated.
            sizes={
              variant === "detail"
                ? "(max-width: 1024px) 100vw, 580px"
                : "192px"
            }
            loading={variant === "detail" && current === 0 ? "eager" : "lazy"}
            fetchPriority={
              variant === "detail" && current === 0 ? "high" : "auto"
            }
            onError={() => handleImageError(current)}
          />
        )}

        {total > 1 && (
          <>
            {/* Prev button */}
            <Button
              type="button"
              variant="secondary"
              shape="pill"
              size="icon"
              // The v2 `overlay` variant is gone with the second interaction
              // colour. Over a photograph an outline alone is illegible, so
              // the control wears a paper fill here — a call-site treatment,
              // not a new variant.
              className={cn(
                "absolute top-1/2 -translate-y-1/2 bg-ground/90 hover:bg-ground",
                variant === "detail" ? "left-4" : "left-2",
              )}
              onClick={() => goTo(current - 1)}
              aria-label={t("gallery.previous")}
              data-ph-no-autocapture
            >
              <ChevronLeft className="size-5" />
            </Button>

            {/* Next button */}
            <Button
              type="button"
              variant="secondary"
              shape="pill"
              size="icon"
              className={cn(
                "absolute top-1/2 -translate-y-1/2 bg-ground/90 hover:bg-ground",
                variant === "detail" ? "right-4" : "right-2",
              )}
              onClick={() => goTo(current + 1)}
              aria-label={t("gallery.next")}
              data-ph-no-autocapture
            >
              <ChevronRight className="size-5" />
            </Button>

            {/* Counter badge */}
            <span
              className={cn(
                "absolute rounded-full bg-accent/80 px-2.5 py-1 type-metadata text-ground backdrop-blur-sm",
                variant === "detail" ? "bottom-4 right-4" : "bottom-2 right-2",
              )}
            >
              {current + 1} / {total}
            </span>
          </>
        )}
      </div>

      {/* Brand-supplied credit — beside the image, never over it. Interface
          type (the metadata step of the interface face), because it is a note
          about the asset rather than part of the brand's own content. */}
      {isCurrentBrandSupplied && variant === "detail" ? (
        <p
          data-brand-supplied
          className={cn(
            "type-metadata",
            hasDetailGallery && "xl:col-start-2 xl:row-start-2",
          )}
        >
          {t("gallery.brandSupplied")}
        </p>
      ) : null}

      {/* Thumbnail grid */}
      {total > 1 && variant === "detail" && (
        <div className="xl:relative xl:col-start-1 xl:row-start-1 xl:min-h-0 xl:self-stretch">
          <div className="scrollbar-none flex gap-2 overflow-x-auto xl:absolute xl:inset-0 xl:grid xl:grid-cols-1 xl:content-start xl:overflow-y-auto xl:p-1">
            {validImages.map(({ src }, i) => {
              const thumbFill = fill(i, "p-1.5");
              return (
                <Button
                  key={i}
                  type="button"
                  variant="ghost"
                  onClick={() => goTo(i)}
                  className={`relative size-16 overflow-hidden rounded-control p-0 hover:bg-transparent ${
                    i === current
                      ? "ring-2 ring-accent ring-offset-2"
                      : "opacity-70 hover:opacity-100"
                  }`}
                  aria-label={t("gallery.viewPhoto", { n: i + 1 })}
                  data-ph-no-autocapture
                >
                  {brokenImages.has(i) ? (
                    // `surface`, not `surface-deep`: this fallback carries TEXT,
                    // and `--ink-muted` measures 4.17:1 on `surface-deep` — under
                    // the 4.5:1 floor. The token is the image slot ("no text sits
                    // on this", globals.css); the moment a slot renders a letter
                    // instead of a photograph it is a card, and cards are
                    // `surface` (4.6:1).
                    <div className="flex h-full items-center justify-center bg-surface">
                      <span className="type-label text-ink-muted">
                        {initial}
                      </span>
                    </div>
                  ) : (
                    <SurfaceImage
                      src={src}
                      alt={getAlt(i)}
                      fill
                      className={thumbFill}
                      surface="thumb"
                      // The thumbnail strip is a fixed 64px square.
                      sizes="64px"
                      loading={
                        variant === "detail" && i === 0 ? "eager" : "lazy"
                      }
                      onError={() => handleImageError(i)}
                    />
                  )}
                </Button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
