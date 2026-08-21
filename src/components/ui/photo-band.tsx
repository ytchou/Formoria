import type { ComponentProps, ReactNode } from "react";

import { SurfaceImage } from "@/components/ui/image";
import { PageShell } from "@/components/ui/page-shell";
import {
  scrimBackgroundImage,
  type ScrimVariant,
} from "@/lib/design/photo-band-scrims";
import { cn } from "@/lib/utils";

/**
 * A FULL-BLEED PHOTOGRAPH WITH COPY ON TOP OF IT.
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
 * preference — the same gate scans for a stray `absolute inset-0` scrim over
 * `--ground`. Add a variant there rather than an exception here.
 */
export type PhotoBandProps = {
  /** Repo path under `/public`, or an allowed remote host. */
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
   * both withhold `priority` on the grounds that the homepage opener has it.
   */
  priority?: boolean;
  /** Classes for the `<section>` — spacing, mostly. */
  className?: string;
  /** Classes for the inner `PageShell` — alignment of the copy. */
  contentClassName?: string;
  children: ReactNode;
} & Omit<ComponentProps<"section">, "children" | "className">;

export function PhotoBand({
  image,
  alt,
  scrim,
  priority = false,
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
        priority={priority}
        // `fetchPriority` follows `priority` rather than being a second knob:
        // a band that claims the preload wants the high hint too, and one that
        // does not must not send it.
        fetchPriority={priority ? "high" : "auto"}
        surface="hero"
        className="object-cover"
      />

      {/* THE SCRIM. Its opacity is not editable here — it comes from the
          variant's stops, which the contrast gate checks against this exact
          photograph. If a band looks too washed or too dark, the remedy is the
          photograph or the variant, never a local opacity. */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{ backgroundImage: scrimBackgroundImage(scrim) }}
      />

      {/* `relative` keeps the copy above the absolute scrim behind it. */}
      <PageShell measure="page" className={cn("relative", contentClassName)}>
        {children}
      </PageShell>
    </section>
  );
}
