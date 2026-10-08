import { TrailTile, type TrailTileLabels } from "@/components/landing/trail-tile";
import { gridStyles } from "@/components/ui/grid";
import type { TrailCard, TrailPeekProduct } from "@/lib/trails/trail-card";

/**
 * The /style hub's card grid: one TrailTile per listed trail, with its peek.
 * Takes the card projections, not whole entries: TrailTile is a client
 * component, so every field passed here is serialized into the page (DEV-1972).
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
      {trails.map((trail, index) => (
        <TrailTile
          key={trail.slug}
          trail={trail}
          position={index}
          trailSurface="style_hub"
          headingLevel="h2"
          peek={peeks[trail.slug]}
          labels={labels}
        />
      ))}
    </ul>
  );
}
