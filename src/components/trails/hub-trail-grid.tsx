import { TrailTile, type TrailTileLabels } from "@/components/landing/trail-tile";
import { gridStyles } from "@/components/ui/grid";
import type { CuratedProduct } from "@/lib/services/curated-products";
import type { TrailEntry } from "@/lib/services/trails";

/** The /style hub's card grid: one TrailTile per listed trail, with its peek. */
export function HubTrailGrid({
  trails,
  peeks,
  labels,
}: {
  trails: TrailEntry[];
  peeks: Record<string, CuratedProduct[]>;
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
