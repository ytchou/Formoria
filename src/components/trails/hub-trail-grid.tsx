import { TrailTile, type TrailTileLabels } from "@/components/landing/trail-tile";
import { gridStyles } from "@/components/ui/grid";
import type { TrailCard, TrailPeekProduct } from "@/lib/trails/trail-card";

/**
 * The /style hub's card grid: one TrailTile per listed trail, with its peek.
 * Takes the card projections, not whole entries: TrailTile is a client
 * component, so every field passed here is serialized into the page (DEV-1972).
 *
 * DESIGN.md §8 TrailCard feature variant: the newest trail (`trails[0]`,
 * `getAllTrails` sorts by publishedAt desc and the tag filter keeps order) is
 * one full-width band; the rest follow in the pair grid, and an odd last trail
 * spans both columns rather than sitting alone. Still one list.
 */
export function HubTrailGrid({
  trails,
  peeks,
  labels,
}: {
  trails: TrailCard[];
  peeks: Record<string, TrailPeekProduct[]>;
  labels: TrailTileLabels;
}) {
  return (
    <ul className={gridStyles({ cols: "pair" })}>
      {trails.map((trail, index) => {
        const feature = index === 0;
        // The pair grid holds trails.length - 1 tiles; an odd count leaves the
        // last one alone in its row.
        const spansLast =
          !feature &&
          index === trails.length - 1 &&
          (trails.length - 1) % 2 === 1;
        return (
          <TrailTile
            key={trail.slug}
            trail={trail}
            position={index}
            trailSurface="style_hub"
            headingLevel="h2"
            peek={peeks[trail.slug]}
            labels={labels}
            variant={feature ? "feature" : "default"}
            singleColumn={spansLast}
            className={feature || spansLast ? "md:col-span-2" : undefined}
          />
        );
      })}
    </ul>
  );
}
