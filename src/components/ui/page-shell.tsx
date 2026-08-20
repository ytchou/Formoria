import type { ComponentPropsWithRef, ElementType, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * The page shell, written once.
 *
 * `mx-auto w-full max-w-…` plus a gutter was spelled out at every route root on
 * the public site, with ten different caps between them and nothing enforcing
 * agreement — which is how the sticky header came to start its content 360px
 * from a 1920px viewport edge while the landing bands started at 200px. The
 * three measures live in `globals.css`; this is the one place that decides
 * which gutter goes with which measure.
 *
 * The escape hatch for a caller that must own its own element — an existing
 * `<main>` with attributes, a `<section>` a parent already renders — is to read
 * the class string directly:
 *
 *   <main className={cn(shellStyles({ measure: "prose" }), "py-section")}>
 *
 * exactly as `CARD_GRID_COLUMNS` works in `grid.tsx`. A caller that cannot use
 * the component must still be able to read the one formula rather than copy it.
 */

/**
 * A variant name maps to a CLASS NAME, never to a raw value.
 *
 * The number itself lives in the `@utility` block in `globals.css` and appears
 * nowhere else in TypeScript. An entry here spelling the form measure as an
 * arbitrary 64rem cap would be a second declaration of the same measure that no
 * stylesheet edit could reach — the exact drift this component exists to end.
 *
 * That cap is described rather than typed on purpose. Tailwind scans comments
 * as content, so writing the class out here emits a real CSS rule nothing uses,
 * in the one file whose job is to make sure no such rule is ever needed.
 */
export const PAGE_MEASURES = {
  page: "page-measure",
  form: "form-measure",
  prose: "prose-measure",
} as const;

export const shellStyles = cva("mx-auto w-full", {
  variants: {
    /** Which of the three page widths this is. See `globals.css`. */
    measure: PAGE_MEASURES,
    /**
     * THE GUTTER DIFFERS PER MEASURE, so both entries here are empty and the
     * real class is picked in `compoundVariants` below. Spelling a gutter here
     * would force one padding on all three widths, and `page` is the only one
     * that takes the third step at 1280px.
     */
    gutter: {
      default: "",
      /**
       * For a measure applied to an element that is ALREADY inside a gutter'd
       * ancestor — `dashboard/loading.tsx` caps a grid that its `<main>` has
       * already inset, and a second gutter there would inset it twice. It is a
       * variant rather than an omission so the call site says which of the two
       * it meant.
       */
      none: "",
    },
  },
  compoundVariants: [
    { measure: "page", gutter: "default", class: "page-gutter-wide" },
    { measure: "form", gutter: "default", class: "page-gutter" },
    { measure: "prose", gutter: "default", class: "page-gutter" },
  ],
  defaultVariants: {
    measure: "page",
    gutter: "default",
  },
});

export type PageShellProps<T extends ElementType = "div"> = VariantProps<
  typeof shellStyles
> &
  // WithRef, matching `Grid`: React 19 passes `ref` through as an ordinary
  // prop, so no `forwardRef` wrapper is needed — but a caller that measures or
  // scrolls its shell does not compile unless the type admits it.
  Omit<ComponentPropsWithRef<T>, "children" | "className"> & {
    /**
     * The element to render. A route root is a `<main>`; a band within a page
     * is a `<section>`. The default `<div>` claims no semantics, because only
     * the caller knows what the region means.
     */
    as?: T;
    children?: ReactNode;
    className?: string;
  };

export function PageShell<T extends ElementType = "div">({
  as,
  className,
  measure,
  gutter,
  ...props
}: PageShellProps<T>) {
  const Component = (as ?? "div") as ElementType;

  return (
    <Component
      className={cn(shellStyles({ measure, gutter }), className)}
      {...props}
    />
  );
}
