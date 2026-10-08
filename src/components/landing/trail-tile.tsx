"use client";

import { useLocale } from "next-intl";

import { SurfaceImage } from "@/components/ui/image";

import { Link } from "@/i18n/navigation";
import { trackTrailCardClicked } from "@/lib/analytics";
import { safeImageSrc } from "@/lib/images/allowed-image-hosts";
import { TRAIL_PEEK_SIZE } from "@/lib/services/curated-products.constants";
import type { TrailCard, TrailPeekProduct } from "@/lib/trails/trail-card";
import { cn } from "@/lib/utils";
import { routes } from "@/lib/routes";
import { contentLangFor } from "@/lib/trails/content-lang";

export type TrailTileLabels = {
  eyebrow: string;
  cta: string;
};

/**
 * The 3:2 ratio follows the photograph while the copy stack sets the floor
 * below md: `overflow-clip` (not `overflow-hidden`, which makes a scroll
 * container) and no fixed `min-h` leave the aspect-ratio box its content-based
 * minimum, so a three-line promise grows the tile instead of pushing the title
 * off its top edge, as the old fixed 224px floor did at 390px. md and up keep
 * a 320px floor. A single-column band also has a ceiling so it cannot grow
 * taller than the viewport-scale section it belongs to.
 *
 * `variant="feature"` is the DESIGN.md §8 TrailCard feature variant (/style hub
 * only): a full-width band at 4:3 below md and 21:9 from md, title in
 * `type-section` at every width. It keeps the same overflow-clip, no-fixed-min-h
 * floor below md, so the copy still grows the band instead of clipping.
 *
 * The optional peek sits BELOW the band, inside the same list item, and is
 * decorative: the one card link already carries the trail's name.
 */
export function TrailTile({
  trail,
  labels,
  position,
  trailSurface,
  peek,
  headingLevel = "h3",
  singleColumn = false,
  variant = "default",
  className,
}: {
  trail: TrailCard;
  labels: TrailTileLabels;
  position: number;
  /** Analytics surface reported with the click, e.g. `homepage_trails`. */
  trailSurface: string;
  peek?: TrailPeekProduct[];
  headingLevel?: "h2" | "h3";
  singleColumn?: boolean;
  variant?: "default" | "feature";
  className?: string;
}) {
  const Heading = headingLevel;
  const feature = variant === "feature";
  // Trails are authored in zh-TW and listed on /en too; mark the copy so a
  // screen reader switches voice instead of reading 中文 with an English one.
  const contentLang = contentLangFor(trail.frontmatter.locale, useLocale());
  const peekItems = (peek ?? []).slice(0, TRAIL_PEEK_SIZE);
  const title = trail.frontmatter.title;
  const promise =
    trail.frontmatter.promise ?? trail.frontmatter.description ?? "";
  /*
   * `safeImageSrc` now owns the same-origin case itself (DEV-1551), so a hero
   * committed at `/images/trails/x.webp` survives without a caller-side
   * leading-slash branch — and a protocol-relative `//host/x.png`, which such a
   * branch waved through, does not.
   *
   * The imageless branch below stays: it is the degradation path for a 404 or a
   * disallowed host, not a supply gate.
   */
  const imageSrc = safeImageSrc(trail.frontmatter.heroImage);
  /*
   * Empty, never the title. The link is already `aria-labelledby` the title
   * beside it, so repeating the title as image text announces the same words
   * twice.
   */
  const imageAlt = trail.frontmatter.heroImageAlt ?? "";
  const titleId = `trail-${trail.slug}-title`;

  return (
    <li
      data-variant={variant}
      // A single-column band spans its whole grid row; the caller sets the span.
      data-span={singleColumn ? "full" : undefined}
      className={cn("flex list-none flex-col gap-2", className)}
    >
      <Link
        href={routes.trail(trail.slug)}
        prefetch={false}
        aria-labelledby={titleId}
        data-ph-no-autocapture
        onClick={() =>
          trackTrailCardClicked(trail.slug, position, trailSurface)
        }
        className={cn(
          "group relative flex flex-col justify-end overflow-clip rounded-surface bg-ink p-5 text-ground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-3 md:min-h-80 md:p-8",
          feature ? "aspect-[4/3] md:aspect-[21/9]" : "aspect-[3/2]",
          singleColumn && "max-h-[35rem]",
        )}
      >
        {imageSrc ? (
          <SurfaceImage
            src={imageSrc}
            alt={imageAlt}
            fill
            sizes={
              feature || singleColumn
                ? "100vw"
                : "(max-width: 1024px) 100vw, 33vw"
            }
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:duration-[0.01ms]"
          />
        ) : null}
        {/*
          The scrim belongs to the copy block, not the tile. A tile-wide
          gradient fades out at a fixed height, but the copy's height varies
          (two-line titles, three-line promises, a 224px phone tile), so text
          that rose above the dark stop sat on bare photograph at 1.3–2.7:1.
          Sized by the copy, ink/80 or darker sits behind every line (ground
          8.5:1, on-ink 5.8:1 even over pure white), the fade above it is a
          fixed band, and everything higher stays photograph. The negative
          margins carry the block to the tile's edges through its padding.
        */}
        <span className="relative z-10 -mx-5 -mb-5 bg-gradient-to-t from-ink/90 to-ink/80 px-5 pt-1 pb-5 md:-mx-8 md:-mb-8 md:px-8 md:pb-8">
          <span
            aria-hidden="true"
            className="absolute inset-x-0 bottom-full h-16 bg-gradient-to-t from-ink/80 to-transparent md:h-24"
          />
          <span className="flex max-w-xl flex-col items-start gap-3">
            <span className="rounded-full border border-ground/30 bg-ink px-3 py-1 type-eyebrow text-ground">
              {labels.eyebrow}
            </span>
            {/*
            `lang` on the title and promise only: the eyebrow and CTA are UI
            labels in the page's own language.
          */}
            <Heading
              id={titleId}
              lang={contentLang}
              className={cn(
                "line-clamp-2 text-ground",
                feature
                  ? "type-section"
                  : "type-card-title md:type-section md:text-ground",
              )}
            >
              {title}
            </Heading>
            {promise ? (
              <span
                lang={contentLang}
                className="type-body text-on-ink line-clamp-3"
              >
                {promise}
              </span>
            ) : null}
            <span className="inline-flex min-h-12 items-center font-medium text-ground underline underline-offset-4 transition-colors group-hover:text-ground/80">
              {labels.cta}
            </span>
          </span>
        </span>
      </Link>
      {peekItems.length > 0 ? (
        <ul aria-hidden="true" className="grid grid-cols-4 gap-2">
          {peekItems.map((product) => {
            const peekSrc = safeImageSrc(product.imageUrl);
            return (
              <li
                key={product.id}
                className="relative aspect-square overflow-hidden rounded-surface bg-surface-deep"
              >
                {peekSrc ? (
                  <SurfaceImage
                    src={peekSrc}
                    alt=""
                    // A quarter of a card cell: ~80px on a phone, ~110px in
                    // the three-up grid. A fixed 120px box rather than `fill` +
                    // `sizes="120px"`: Next then emits a 1x/2x srcSet (128w,
                    // 256w) instead of every configured width (DEV-1972). The
                    // classes stretch it over the square cell exactly as
                    // `fill` did.
                    width={120}
                    height={120}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}
