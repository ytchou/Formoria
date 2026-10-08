import type { ReactNode } from "react";

import { Grid } from "@/components/ui/grid";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Tiles a phone shows per category group. A single phone column of all ten
 * tiles ran to ~4,300px and buried the trails and stories below the band, so
 * phones get two-up and the first six; the see-all CTA under the grid carries
 * the rest. Every tile stays in the HTML — the cap is `max-sm:hidden`, which is
 * `display: none`, so hidden tiles also leave the phone tab order.
 */
export const PHONE_TILE_LIMIT = 6;

/** The grid's tile count: two rows of the five-column desktop layout. */
const PLACEHOLDER_TILE_COUNT = 10;

/** The phone cap as a class, for a real tile and a placeholder alike. */
export function phoneCapClass(index: number): string | false {
  return index >= PHONE_TILE_LIMIT && "max-sm:hidden";
}

/**
 * One homepage band group: the `data-category` wrapper and its grid. Light on
 * purpose — no tile import — so the client filter can draw placeholders in the
 * same shape without pulling the tile into the homepage's initial bundle.
 */
export function WallGroup({
  slug,
  busy,
  children,
}: {
  /** Omitted only by the lazy chunk's loading fallback, which has no slug. */
  slug?: string;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <div data-category={slug} aria-busy={busy || undefined}>
      {/* `cols="cards"` is one column below `sm`; `grid-cols-2` wins
          that through tailwind-merge, so phones are two-up while `sm`
          and `md` keep two and `lg` five. The phone gap is the `tight`
          Grid gap (the gutter token halved), not a numeric step. */}
      <Grid
        as="ul"
        cols="cards"
        className="mt-8 list-none p-0 grid-cols-2 max-sm:gap-[calc(var(--space-gutter)/2)] lg:grid-cols-5"
      >
        {children}
      </Grid>
    </div>
  );
}

/** Square placeholders in the group's shape while a category loads. */
export function WallGroupPlaceholder({ slug }: { slug?: string }) {
  return (
    <WallGroup slug={slug} busy>
      {Array.from({ length: PLACEHOLDER_TILE_COUNT }, (_, index) => (
        <li
          key={index}
          aria-hidden="true"
          className={cn("list-none", phoneCapClass(index))}
        >
          <Skeleton className="aspect-square w-full" />
        </li>
      ))}
    </WallGroup>
  );
}
