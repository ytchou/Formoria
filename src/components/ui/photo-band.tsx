import type { ComponentProps, ReactNode } from "react";

import { SurfaceImage } from "@/components/ui/image";
import { PageShell } from "@/components/ui/page-shell";
import {
  scrimClassName,
  scrimStyleRules,
  type ScrimVariant,
} from "@/lib/design/photo-band-scrims";
import { cn } from "@/lib/utils";

/**
 * A FULL-BLEED PHOTOGRAPHIC BAND, WITH OPTIONAL COPY ON TOP OF IT.
 *
 * IT IS ONE COMPONENT BECAUSE IT WAS TWO HAND-ROLLED COPIES. The homepage
 * opener and the manifesto band each carried the same four layers — a
 * `relative overflow-hidden` section, a `fill` image, an `absolute inset-0`
 * scrim, and a `relative` shell to lift the copy above it — and they had
 * already drifted on the layer that matters: each picked its own scrim opacity
 * by eye, each justified it in its own comment, and one of them was under the
 * AA contrast floor for months without anything noticing. A convention applied
 * by hand at two call sites is not a standard.
 *
 * WHAT THIS COMPONENT OWNS is the construction and the scrim. What it does NOT
 * own is the photograph's suitability — that is
 * `scripts/check-photo-band-contrast.ts`, which composites each band's real
 * pixels under the real scrim and fails `pnpm lint` under 4.5:1. The stops
 * themselves are a contract in `@/lib/design/photo-band-scrims`, never tuned
 * per image; see that module for why.
 *
 * Hand-rolling this construction elsewhere is a lint failure, not a style
 * preference — the same gate scans for a full-bleed absolutely positioned
 * scrim (a translucent background, an arbitrary colour, or a gradient) outside
 * this file, whether the classes are written inline, through `cn`, or in a
 * template literal. Add a variant there rather than an exception here. Two
 * surfaces that predate the gate carry named exemptions in it; a third needs a
 * ticket, not a third entry.
 */
export type PhotoBandProps = {
  /**
   * Repo path under `/public`, and only that. `SurfaceImage` itself accepts a
   * remote host, but `scripts/check-photo-band-contrast.ts` has to open the
   * file to measure it, so a band whose photograph lives off disk cannot be
   * proved legible and is rejected by name at lint time rather than shipped
   * unchecked. Supporting one means giving the gate a way to fetch and cache
   * it, which nothing has needed yet.
   */
  image: string;
  /**
   * Empty for decorative, which is the usual case: the band's own heading says
   * what the band is, and a screen reader repeating it as image text is noise.
   * A band whose photograph carries information the copy does not should pass
   * a real description.
   */
  alt: string;
  /**
   * Named after the alignment of the copy inside, not after the picture. The
   * scrim tracks the text block — that is the whole rule.
   */
  scrim: ScrimVariant;
  /**
   * `true` only for a band inside the first viewport. At most ONE surface on a
   * route may claim it; `landing-zones.tsx` and `selected-product-tile.tsx`
   * both withhold it on the grounds that the homepage opener has it.
   *
   * `preload`, not `priority`: next 16 deprecated the older name and tsc
   * reports it. The behaviour is the same preload link and the same high
   * fetch priority.
   */
  preload?: boolean;
  /** Optional Next image quality for a specific photograph. */
  imageQuality?: number;
  /** Classes for the `<section>` — spacing, mostly. */
  className?: string;
  /** Classes for the inner `PageShell` — alignment of the copy. */
  contentClassName?: string;
  /** Optional for a purely decorative photographic band. */
  children?: ReactNode;
} & Omit<ComponentProps<"section">, "children" | "className">;

export function PhotoBand({
  image,
  alt,
  scrim,
  preload = false,
  imageQuality,
  className,
  contentClassName,
  children,
  ...sectionProps
}: PhotoBandProps) {
  return (
    <section
      {...sectionProps}
      className={cn("relative overflow-hidden py-section", className)}
    >
      <SurfaceImage
        src={image}
        alt={alt}
        fill
        preload={preload}
        // `fetchPriority` follows `preload` rather than being a second knob:
        // a band that claims the preload wants the high hint too, and one that
        // does not must not send it.
        fetchPriority={preload ? "high" : "auto"}
        quality={imageQuality}
        surface="hero"
        className="object-cover"
      />

      {/* THE SCRIM. Its opacity is not editable here — it comes from the
          variant's stops, which the contrast gate checks against this exact
          photograph, at every width the variant declares. If a band looks too
          washed or too dark, the remedy is the photograph or the variant,
          never a local opacity.

          A stylesheet rather than an inline `style` because the stops differ
          per breakpoint and the `style` prop cannot hold a media query; the
          rules are generated from the same spec the gate measures, so there is
          no second copy of the numbers to drift. */}
      <style>{scrimStyleRules(scrim)}</style>
      <div
        aria-hidden="true"
        className={cn("absolute inset-0", scrimClassName(scrim))}
      />

      {children != null && (
        // `relative` keeps the copy above the absolute scrim behind it.
        <PageShell measure="page" className={cn("relative", contentClassName)}>
          {children}
        </PageShell>
      )}
    </section>
  );
}
