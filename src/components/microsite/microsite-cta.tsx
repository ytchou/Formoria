import type { AnchorHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/**
 * THE MICROSITE'S ONE CALL TO ACTION, IN ONE PLACE.
 *
 * `hero.tsx`, `contact-cta.tsx` and `product-grid.tsx` each carried a
 * hand-written copy of this class string. Every one of them is a LINK — an
 * anchor to `#contact`, a `mailto:`, an off-site product URL — so this renders
 * an `<a>` and not the system `Button`.
 *
 * It paints from `--brand-accent` / `--brand-accent-foreground` and NOT from
 * the system palette. Those two custom properties are the brand's property and
 * are the one documented exception to design system v2 — see `tokens.ts` and
 * DESIGN.md §2. Do not "finish the job" by swapping them for accent tokens.
 *
 * The focus ring is the brand accent held off the fill by a 2px ground offset,
 * which is exactly how the system `Button` draws a ring on top of its own fill.
 */
const ctaBase = cn(
  "inline-flex min-h-11 items-center justify-center rounded-control type-button",
  "focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-ground focus-visible:outline-none",
  "active:scale-[0.98] motion-reduce:transition-none",
);

const ctaVariants = {
  // The brand's accent as a fill. The label colour is set inline rather than
  // through an arbitrary-value colour utility wrapping the CSS variable,
  // because `type-button` carries `text-ink` of its own and two single-class
  // colour rules leave CSS source order to decide which one a brand's CTA gets.
  //
  // Do not write that utility's class name out here, even as an example:
  // Tailwind scans comments for candidates, so naming it generates a rule with
  // a literal ellipsis in it, which fails to parse and 500s every route.
  solid: "bg-[var(--brand-accent)] px-6 transition-transform",
  // The secondary weight: a rule, with the accent arriving only on hover.
  outline: cn(
    "border border-rule px-4 transition-colors",
    "hover:border-[var(--brand-accent)] hover:text-[var(--brand-accent)]",
  ),
} as const;

type MicrositeCtaVariant = keyof typeof ctaVariants;

type MicrositeCtaProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  variant?: MicrositeCtaVariant;
};

export function MicrositeCta({
  href,
  variant = "solid",
  className,
  style,
  children,
  ...props
}: MicrositeCtaProps) {
  return (
    <a
      href={href}
      className={cn(ctaBase, ctaVariants[variant], className)}
      style={
        variant === "solid"
          ? { color: "var(--brand-accent-foreground)", ...style }
          : style
      }
      {...props}
    >
      {children}
    </a>
  );
}
