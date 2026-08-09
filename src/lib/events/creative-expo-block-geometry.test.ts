import { describe, expect, it } from "vitest";
import geometry from "../../../content/events/2026-taiwan-creative-expo.block-geometry.json";
import ledger from "../../../content/events/2026-taiwan-creative-expo.exhibitors.json";
import {
  EXPO_FLOOR_MAP_GEOMETRY,
  EXPO_ZONE_DEFINITIONS,
} from "@/components/events/taiwan-creative-expo-floor-map-config";

/**
 * `content/events/2026-taiwan-creative-expo.block-geometry.json` is derived from
 * the floor-map raster by `scripts/extract-expo-block-geometry.mjs`, which reads
 * each block's printed code with OCR. A *missing* block is obvious on the page;
 * a *mis-assigned* one is not -- the map looks perfect while pointing a booth at
 * the wrong brand. These are the checks that make that failure loud.
 */

const BOOTH_CODE = /^(K1|K2|K3|S)-(\d+)(?:-(\d+))?$/;

function blockOf(booth: string): string | null {
  const match = BOOTH_CODE.exec(booth);
  return match ? `${match[1]}-${match[2]}` : null;
}

const ledgerBlocks = new Map<string, string[]>();
for (const exhibitor of ledger.exhibitors) {
  const block = blockOf(exhibitor.booth);
  if (!block) continue;
  ledgerBlocks.set(block, [
    ...(ledgerBlocks.get(block) ?? []),
    exhibitor.booth,
  ]);
}

const zoneBounds = new Map(
  EXPO_ZONE_DEFINITIONS.map((zone) => {
    const xs = zone.polygon.map(([x]) => x);
    const ys = zone.polygon.map(([, y]) => y);
    return [
      zone.code,
      {
        x0: Math.min(...xs),
        y0: Math.min(...ys),
        x1: Math.max(...xs),
        y1: Math.max(...ys),
      },
    ];
  }),
);

describe("creative expo block geometry", () => {
  it("declares the same coordinate space as the floor map", () => {
    expect(geometry.viewBox).toBe(EXPO_FLOOR_MAP_GEOMETRY.viewBox);
  });

  it("gives every ledger block exactly one rect", () => {
    const geometryBlocks = geometry.blocks.map((block) => block.block);
    expect(new Set(geometryBlocks).size).toBe(geometryBlocks.length);

    const missing = [...ledgerBlocks.keys()].filter(
      (block) => !geometryBlocks.includes(block),
    );
    expect(missing).toEqual([]);
  });

  it("covers every ledger booth, including sub-booths", () => {
    const placed = new Set(geometry.blocks.flatMap((block) => block.booths));
    const expected = ledger.exhibitors
      .map((exhibitor) => exhibitor.booth)
      .filter((booth) => BOOTH_CODE.test(booth));

    expect(expected.filter((booth) => !placed.has(booth))).toEqual([]);
  });

  it("keeps each sub-booth under its own parent block", () => {
    for (const block of geometry.blocks) {
      for (const booth of block.booths) {
        expect(blockOf(booth)).toBe(block.block);
      }
    }
  });

  it("places every rect inside its own zone", () => {
    // Doubles as proof that the raster and the zone polygons share one
    // coordinate space, rather than the extraction assuming they do.
    const escaped = geometry.blocks.filter((block) => {
      const bounds = zoneBounds.get(block.zone as never);
      if (!bounds) return true;
      return (
        block.x < bounds.x0 ||
        block.y < bounds.y0 ||
        block.x + block.width > bounds.x1 ||
        block.y + block.height > bounds.y1
      );
    });

    expect(escaped.map((block) => block.block)).toEqual([]);
  });

  it("does not overlap rects", () => {
    // Two blocks sharing pixels means one component swallowed its neighbour,
    // which is how a booth silently inherits the wrong brand.
    const overlaps: string[] = [];
    for (let i = 0; i < geometry.blocks.length; i += 1) {
      for (let j = i + 1; j < geometry.blocks.length; j += 1) {
        const a = geometry.blocks[i];
        const b = geometry.blocks[j];
        if (
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height
        ) {
          overlaps.push(`${a.block}/${b.block}`);
        }
      }
    }
    expect(overlaps).toEqual([]);
  });

  // There is deliberately no spatial-ordering guard here. A swapped pair of
  // labels satisfies every check above, so the obvious candidate was to assert
  // that codes run left-to-right within a row, or that consecutive codes sit
  // near each other. Neither holds on this floor plan: K3 numbers do not run
  // row-major at all, and consecutive codes are more than three block-widths
  // apart 13-30% of the time per zone, which buries the four outliers a swap
  // would add. The protections that do work are the closed-vocabulary OCR with
  // no fuzzy fallback (scripts/extract-expo-block-geometry.mjs refuses a
  // near-match rather than guessing, because adjacent booths differ by one
  // digit) and the annotated verification sheet that script writes under
  // VERIFY=1.

  it("marks blocks the ledger does not list", () => {
    // The printed map carries stands Formoria never catalogued. They are real
    // booths and render as unlisted ghosts, so they must have no booths[] --
    // an unlisted block that claims exhibitors would be a mis-assignment.
    for (const block of geometry.blocks) {
      if (ledgerBlocks.has(block.block)) continue;
      expect(block.booths).toEqual([]);
    }
  });
});
