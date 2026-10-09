import { describe, expect, it } from "vitest";

import { trailGridColumns } from "../trail-products";

/**
 * Columns in effect at a breakpoint, read back from the class string. Tailwind
 * is mobile-first, so the widest prefix at or below the breakpoint wins.
 */
const ORDER = ["", "sm", "md", "lg", "xl", "2xl"] as const;
function columnsAt(classes: string, breakpoint: (typeof ORDER)[number]) {
  let cols = 1;
  for (const prefix of ORDER.slice(0, ORDER.indexOf(breakpoint) + 1)) {
    const pattern = new RegExp(
      `(?:^|\\s)${prefix ? `${prefix}:` : ""}grid-cols-(\\d+)(?:\\s|$)`,
    );
    const match = classes.match(pattern);
    if (match?.[1]) cols = Number(match[1]);
  }
  return cols;
}

describe("trailGridColumns", () => {
  it.each([
    [1, "grid-cols-2 lg:grid-cols-3"],
    [2, "grid-cols-2"],
    [3, "grid-cols-2 lg:grid-cols-3"],
    [4, "grid-cols-2 xl:grid-cols-4"],
    [5, "grid-cols-2 lg:grid-cols-3"],
    [6, "grid-cols-2 lg:grid-cols-3"],
    [7, "grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"],
    [8, "grid-cols-2 xl:grid-cols-4"],
  ])("%i products -> %s", (count, expected) => {
    expect(trailGridColumns(count)).toBe(expected);
  });

  it("is two-up on phones for every count", () => {
    for (let count = 1; count <= 12; count += 1) {
      expect(columnsAt(trailGridColumns(count), "")).toBe(2);
    }
  });

  it("never leaves a lone tile beside empty cells at 1440 (xl) for 2-8 products", () => {
    for (let count = 2; count <= 8; count += 1) {
      const cols = columnsAt(trailGridColumns(count), "xl");
      const lastRow = count % cols;
      // A full last row, or one holding at least two tiles.
      expect(lastRow === 0 || lastRow >= 2, `count ${count}, ${cols} cols`).toBe(
        true,
      );
    }
  });

  it("keeps a single product at one tile's width rather than stretching it", () => {
    expect(columnsAt(trailGridColumns(1), "")).toBe(2);
    expect(columnsAt(trailGridColumns(1), "xl")).toBe(3);
  });
});
