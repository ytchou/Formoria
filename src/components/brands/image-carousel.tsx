"use client";

import { useEffect, useState, useRef } from "react";
import type { KeyboardEvent } from "react";
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

// Horizontal travel before a touch counts as a swipe rather than a tap.
const SWIPE_MIN_PX = 40;

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
  // Failed images are keyed by `src`, never by display index: removing one
  // shifts every later display index, so an index-keyed set would start
  // naming the wrong photographs the moment the first one failed (BD2-06).
  const [brokenSrcs, setBrokenSrcs] = useState<Set<string>>(new Set());
  // The navigable set. A photo that failed to load leaves it entirely — the
  // counter, arrows, rail, swipe and completion tracking all read this list,
  // so nothing promises a photograph the visitor cannot see.
  const visibleImages = validImages.filter(({ src }) => !brokenSrcs.has(src));
  const total = visibleImages.length;
  const [currentState, setCurrent] = useState(0);
  // Clamped at read time: a failure (or a prop change) can shorten the list
  // under a stored index. When the last photo fails, the one before it shows.
  const current = Math.min(currentState, Math.max(total - 1, 0));
  const [previous, setPrevious] = useState<number | null>(null);
  // Keyed by `src` for the same reason as `brokenSrcs`.
  const viewedSrcs = useRef(
    new Set<string>(validImages[0] ? [validImages[0].src] : []),
  );
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const completedFired = useRef(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const thumbRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // A fade still pending at unmount would call setState on a dead tree.
  useEffect(() => () => clearTimeout(fadeTimerRef.current), []);

  /*
   * Keep the active thumbnail inside the rail (BD2-25).
   *
   * Scrolls the RAIL only. `element.scrollIntoView()` would also scroll every
   * scrollable ancestor — the page included — every time the photo changed.
   * One computation serves both layouts: the horizontal strip cannot scroll
   * vertically and the xl rail cannot scroll horizontally, so the off-axis
   * delta is always zero. The `p-1` on the rail is exactly the 4px the active
   * ring (`ring-2 ring-offset-2`) needs, so it is included in the measurement.
   */
  useEffect(() => {
    const rail = railRef.current;
    const thumb = thumbRefs.current[current];
    if (!rail || !thumb || typeof rail.scrollTo !== "function") return;
    const RING_PX = 4;
    const railBox = rail.getBoundingClientRect();
    const box = thumb.getBoundingClientRect();
    let dx = 0;
    if (box.left - RING_PX < railBox.left) dx = box.left - RING_PX - railBox.left;
    else if (box.right + RING_PX > railBox.right)
      dx = box.right + RING_PX - railBox.right;
    let dy = 0;
    if (box.top - RING_PX < railBox.top) dy = box.top - RING_PX - railBox.top;
    else if (box.bottom + RING_PX > railBox.bottom)
      dy = box.bottom + RING_PX - railBox.bottom;
    if (dx === 0 && dy === 0) return;
    const reduceMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    rail.scrollTo({
      left: rail.scrollLeft + dx,
      top: rail.scrollTop + dy,
      behavior: reduceMotion ? "instant" : "smooth",
    });
  }, [current]);

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
  //
  // `index` is a position in the VISIBLE list; its `sourceIndex` still points
  // into the unfiltered `images` prop, whatever was dropped by host filtering
  // or by a load failure.
  function metaFor(index: number): BrandImageMeta | undefined {
    const sourceIndex = visibleImages[index]?.sourceIndex;
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

  /*
   * A failed image leaves the navigable set (BD2-06).
   *
   * The photo on screen stays on screen: a failure BEFORE it decrements the
   * stored index so the same photograph keeps its place. When the current
   * photo itself fails, the index stays and the next photo slides into it
   * (the read-time clamp covers the last one). `previous` is cleared so
   * nothing cross-fades out of a broken or shifted slot.
   *
   * `failedAt` is read from this render's list. Several failures landing in
   * one batch each see the same list, and each decrement accounts for exactly
   * one removal before the current photo, so the result is still right.
   */
  function handleImageError(src: string) {
    const failedAt = visibleImages.findIndex((image) => image.src === src);
    if (failedAt === -1) return;
    setBrokenSrcs((prev) => new Set(prev).add(src));
    setCurrent((c) => (failedAt < c ? c - 1 : c));
    clearTimeout(fadeTimerRef.current);
    setPrevious(null);
  }

  function goTo(index: number) {
    const next = ((index % total) + total) % total;
    if (next === current) return;
    clearTimeout(fadeTimerRef.current);
    setPrevious(current);
    setCurrent(next);
    const nextImage = visibleImages[next];
    if (nextImage) viewedSrcs.current.add(nextImage.src);
    if (trackingEnabled) {
      trackGalleryPhotoView(brandSlug, next, brandId);
      reportEngagement("gallery");
      if (
        !completedFired.current &&
        visibleImages.every(({ src }) => viewedSrcs.current.has(src))
      ) {
        completedFired.current = true;
        trackGalleryCompleted(brandId, brandSlug, total);
      }
    }
    fadeTimerRef.current = setTimeout(() => setPrevious(null), 200);
  }

  // The rail is ONE tab stop (roving tabindex, BD2-08): ten photos used to put
  // ten tab stops between the visitor and the primary CTA. Arrows move within
  // it and wrap; Home/End jump to the ends. Focus follows the selection so the
  // single tabbable thumbnail is always the one that has focus.
  function handleRailKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    let target: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        target = (current + 1) % total;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        target = (current - 1 + total) % total;
        break;
      case "Home":
        target = 0;
        break;
      case "End":
        target = total - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    goTo(target);
    thumbRefs.current[target]?.focus();
  }

  // Swipe is the only navigation cue below `sm`, where the arrows and the
  // thumbnail strip are hidden. A gesture counts only when it is mostly
  // horizontal, so a vertical page scroll that drifts sideways never flips
  // the photo.
  function handleTouchStart(event: React.TouchEvent) {
    const touch = event.touches[0];
    touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  }

  function handleTouchEnd(event: React.TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy)) return;
    goTo(dx < 0 ? current + 1 : current - 1);
  }

  /*
   * Bounds-guarded, not indexed directly.
   *
   * `current` and `previous` are `useState` indices while `visibleImages` is
   * recomputed from props on every render, so a prop change that shortens the
   * list leaves them pointing past the end. Reading `.src` off `undefined`
   * throws and takes the page down; on `main` the same expression merely passed
   * `undefined` through. A missing current image falls back to the brand
   * placeholder, and a missing previous image simply skips the cross-fade.
   */
  const currentImage = visibleImages[current];
  const previousImage =
    previous !== null ? visibleImages[previous] : undefined;
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
        //
        // At xl the hero is a grid item, and a grid item with `mx-auto` and no
        // definite width shrinks to its content. Its only content is an
        // absolutely positioned `fill` image, so it collapsed to 0×0 and took
        // the thumbnail rail's row height with it (DEV-1948). `xl:w-full`
        // gives it the column's width back.
        className={cn(
          "relative mx-auto aspect-media max-w-[70svh] overflow-hidden rounded-surface bg-surface-deep xl:max-w-none",
          hasDetailGallery && "xl:col-start-2 xl:row-start-1 xl:mx-0 xl:w-full",
        )}
        data-brand-hero
        onTouchStart={total > 1 ? handleTouchStart : undefined}
        onTouchEnd={total > 1 ? handleTouchEnd : undefined}
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
            // The detail hero is the 7/12 column: ~672px at >=1280px, 56vw
            // from 1024px, full width below. In the grid variant it is a
            // fixed 192px cell. Neither is the four-up card measure the
            // `card` surface describes, so both are stated.
            sizes={
              variant === "detail"
                ? "(min-width: 1280px) 672px, (min-width: 1024px) 56vw, 100vw"
                : "192px"
            }
            aria-hidden
          />
        )}

        {!currentImage ? (
          <BrandImageFallback
            name={alt}
            category={category ?? null}
            size="detail"
          />
        ) : (
          <SurfaceImage
            key={currentImage.src}
            src={currentImage.src}
            alt={getAlt(current)}
            fill
            className={cn(
              previous !== null && "animate-in fade-in duration-200",
              currentFill,
            )}
            surface="card"
            // The detail hero is the 7/12 column: ~672px at >=1280px, 56vw
            // from 1024px, full width below. In the grid variant it is a
            // fixed 192px cell. Neither is the four-up card measure the
            // `card` surface describes, so both are stated.
            sizes={
              variant === "detail"
                ? "(min-width: 1280px) 672px, (min-width: 1024px) 56vw, 100vw"
                : "192px"
            }
            loading={variant === "detail" && current === 0 ? "eager" : "lazy"}
            fetchPriority={
              variant === "detail" && current === 0 ? "high" : "auto"
            }
            onError={() => handleImageError(currentImage.src)}
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
              // Below `sm` the detail gallery keeps one cue, the counter, and
              // navigates by swipe; arrows and thumbnails would be three.
              className={cn(
                "absolute top-1/2 -translate-y-1/2 bg-ground/90 hover:bg-ground",
                variant === "detail"
                  ? "left-4 hidden sm:inline-flex"
                  : "left-2",
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
                variant === "detail"
                  ? "right-4 hidden sm:inline-flex"
                  : "right-2",
              )}
              onClick={() => goTo(current + 1)}
              aria-label={t("gallery.next")}
              data-ph-no-autocapture
            >
              <ChevronRight className="size-5" />
            </Button>

            {/* Counter badge — paper, not accent: accent is interaction-only
                (DESIGN.md §2) and this is a label. */}
            <span
              className={cn(
                "absolute rounded-surface bg-ground/90 px-2.5 py-1 type-metadata text-ink",
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
        <div className="hidden sm:block xl:relative xl:col-start-1 xl:row-start-1 xl:min-h-0 xl:self-stretch">
          <div
            ref={railRef}
            role="group"
            aria-label={t("gallery.viewer")}
            onKeyDown={handleRailKeyDown}
            // `p-1` at every width: it is the room the active thumbnail's
            // `ring-2 ring-offset-2` needs inside an overflow container that
            // would otherwise clip it (BD2-25).
            className="scrollbar-none flex gap-2 overflow-x-auto p-1 xl:absolute xl:inset-0 xl:grid xl:grid-cols-1 xl:content-start xl:overflow-y-auto"
          >
            {visibleImages.map(({ src, sourceIndex }, i) => {
              const thumbFill = fill(i, "p-1.5");
              return (
                <Button
                  // Stable across removals; `src` could repeat in the data.
                  key={sourceIndex}
                  ref={(node: HTMLButtonElement | null) => {
                    thumbRefs.current[i] = node;
                  }}
                  type="button"
                  variant="ghost"
                  tabIndex={i === current ? 0 : -1}
                  aria-current={i === current ? "true" : undefined}
                  onClick={() => goTo(i)}
                  className={`relative size-16 overflow-hidden rounded-control p-0 hover:bg-transparent ${
                    i === current
                      ? "ring-2 ring-accent ring-offset-2"
                      : "opacity-70 hover:opacity-100"
                  }`}
                  aria-label={t("gallery.viewPhoto", { n: i + 1 })}
                  data-ph-no-autocapture
                >
                  {/* A thumbnail that fails removes itself from the rail. */}
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
                    onError={() => handleImageError(src)}
                  />
                </Button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
