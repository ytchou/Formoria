"use client";

import { ArrowRight } from "lucide-react";
import { useLocale } from "next-intl";

import {
  editorialScrim,
  editorialScrimLayer,
} from "@/components/ui/editorial-scrim";
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
  /**
   * The 主題選物 chip. Omit it where the section heading already says
   * 主題選物 (the homepage band, a trail's related trails), so the tile does
   * not repeat its container (R2-07).
   */
  eyebrow?: string;
  cta: string;
};

/**
 * The 3:2 ratio follows the photograph while the copy stack sets the floor
 * below md: `overflow-clip` (not `overflow-hidden`, which makes a scroll
 * container) and no fixed `min-h` leave the aspect-ratio box its content-based
 * minimum, so a three-line promise grows the tile instead of pushing the title
 * off its top edge, as the old fixed 224px floor did at 390px. md and up keep
 * a 320px floor. A single-column band (the hub's odd last trail, spanning both
 * pair columns) takes the feature band's 21:9 from md, so it never stands
 * taller than the feature above it; below md it is one more 3:2 card.
 *
 * `variant="feature"` is the DESIGN.md §8 TrailCard feature variant (/style hub
 * only): a full-width band at 4:3 below md and 21:9 from md, title in
 * `type-section` at every width. It keeps the same overflow-clip, no-fixed-min-h
 * floor below md, so the copy still grows the band instead of clipping.
 *
 * Default tiles (not feature, not single-column) stand at 4:3, and from lg,
 * where the homepage's three-up cards are ~420px wide, at least 384px tall:
 * with the promise clamped to two lines and no eyebrow, the copy fills about
 * the lower half and the scene stays visible above it (R2-07).
 *
 * Titles wrap and never truncate: `type-card-title` below xl (a three-up
 * card is ~300px wide at 1024px, where 26px titles ran to three lines),
 * `type-section` from xl and for the feature and single-column bands at every
 * width. Every `type-*` role carries a default `text-ink`, and `cn()` cannot
 * merge it away, so `text-ground` is restated at the same breakpoint.
 *
 * The optional peek sits BELOW the band, inside the same list item, and is
 * decorative: the one card link already carries the trail's name. Its four
 * thumbnails never grow past 96px and pack left with an 8px gap on every
 * variant. Spreading them across a pair card (`justify-between`, R2-07) left
 * ~90px gaps beside the feature band's tight strip, so the same four squares
 * read as one strip on the feature and as stray images under the pair (DS-19).
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
  /*
   * The copy stack is bottom-anchored, so a one-line title beside a two-line
   * one sat its eyebrow lower in the row. From md, where default cards stand
   * side by side (the hub's pair grid; the homepage's peeking snap row), the title and the promise each reserve two lines, so every
   * card in a row has the same stack height and the titles line up.
   */
  const alignRow = !feature && !singleColumn;
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
   * Empty, never the title. The link's visible text already includes the
   * title, so repeating it as image text announces the same words twice.
   */
  const imageAlt = trail.frontmatter.heroImageAlt ?? "";

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
        data-ph-no-autocapture
        onClick={() =>
          trackTrailCardClicked(trail.slug, position, trailSurface)
        }
        className={cn(
          "group relative flex flex-col justify-end overflow-clip rounded-surface bg-ink p-5 text-ground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-3 md:min-h-80 md:p-8",
          feature
            ? "aspect-[4/3] md:aspect-[21/9]"
            : singleColumn
              ? "aspect-[3/2] md:aspect-[21/9]"
              : "aspect-[4/3] lg:min-h-96",
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
            // TODO(DEV-2022): import mediaHoverImage / mediaHoverTitle from @/lib/design/media-hover once it merges.
            className="object-cover transition-[scale] duration-300 ease-(--ease-settle) motion-safe:group-hover:scale-[1.03]"
          />
        ) : null}
        {/*
          The scrim belongs to the copy block, not the tile. A tile-wide
          gradient fades out at a fixed height, but the copy's height varies
          (two-line titles, three-line promises, a short phone tile), so text
          that rose above the dark stop sat on bare photograph at 1.3–2.7:1.
          It is ONE layer (EL-07): the old opaque copy block plus a separate
          48/64px fade showed three horizontal seams. The shared editorial
          scrim keeps ink/82 or darker behind every line and eases out above
          the copy over its own runway. The layer is absolutely positioned and
          the link clips it, so it never adds height to a band (DESIGN.md §8
          TrailCard: the band below md is never shorter than its copy, and
          never taller). The negative margins carry the block to the tile's
          edges through its padding.
        */}
        <span className="relative z-10 -mx-5 -mb-5 px-5 pt-1 pb-5 md:-mx-8 md:-mb-8 md:px-8 md:pb-8">
          <span
            aria-hidden="true"
            className={cn(editorialScrimLayer, editorialScrim)}
          />
          <span className="relative flex max-w-xl flex-col items-start gap-2">
            {labels.eyebrow ? (
              <span className="rounded-full border border-ground/30 bg-ink px-3 py-1 type-eyebrow text-ground">
                {labels.eyebrow}
              </span>
            ) : null}
            {/*
            `lang` on the title and promise only: the eyebrow and CTA are UI
            labels in the page's own language.
          */}
            {/*
              The hover cue is an underline that fades in, not the shared
              accent title (EL-05): `--accent` on the ink scrim
              measures ~1.6:1, far under 4.5:1. Accent stays interaction-only
              (DESIGN.md §2) and is used where it can be read, on paper.
            */}
            <Heading
              lang={contentLang}
              className={cn(
                "text-ground underline decoration-transparent underline-offset-4 transition-[text-decoration-color] duration-150 ease-(--ease-settle) group-hover:decoration-current group-active:decoration-current",
                feature || singleColumn
                  ? "type-section"
                  : "type-card-title xl:type-section xl:text-ground",
                alignRow && "md:min-h-[2lh]",
              )}
            >
              {title}
            </Heading>
            {promise ? (
              <span
                lang={contentLang}
                className={cn(
                  "type-body text-on-ink",
                  alignRow ? "line-clamp-2 md:min-h-[2lh]" : "line-clamp-3",
                )}
              >
                {promise}
              </span>
            ) : null}
            {/* The whole tile is the link, so the CTA needs no 48px target
                of its own. The arrow is the icon every other action uses,
                never a glyph in the label (DS2-29). */}
            <span className="mt-1 inline-flex items-center gap-1 font-medium text-ground transition-colors group-hover:text-ground/80">
              <span className="underline underline-offset-4">{labels.cta}</span>
              <ArrowRight aria-hidden="true" className="size-4" />
            </span>
          </span>
        </span>
      </Link>
      {peekItems.length > 0 ? (
        <ul
          aria-hidden="true"
          className="grid grid-cols-[repeat(4,minmax(0,6rem))] gap-2"
        >
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
                    // A quarter of a card cell, capped at 96px by the grid's
                    // columns: ~70px on a phone, at most 96px elsewhere. A
                    // fixed 96px box rather than `fill` + `sizes="96px"`: Next
                    // then emits a 1x/2x srcSet instead of every configured
                    // width (DEV-1972). The classes stretch it over the square
                    // cell exactly as `fill` did.
                    width={96}
                    height={96}
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
