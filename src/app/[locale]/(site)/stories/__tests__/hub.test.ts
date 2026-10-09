import { describe, expect, it } from "vitest";

import type { StoryEntry } from "@/lib/services/stories";
import { orderUngrouped, seriesPartOrder } from "../page";

const story = (
  slug: string,
  publishedAt: string,
  seriesOrder?: number,
): StoryEntry =>
  ({
    slug,
    content: "",
    frontmatter: {
      title: slug,
      slug,
      tags: [],
      locale: "zh-TW",
      publishedAt,
      draft: false,
      ...(seriesOrder === undefined ? {} : { seriesOrder }),
    },
  }) as unknown as StoryEntry;

describe("stories hub", () => {
  // DS2-22: each series card is labelled 第 N 篇 / Part N. The authored
  // `seriesOrder` wins; without one the position in the band stands in.
  it("labels a series part by its authored order, else its position", () => {
    expect(seriesPartOrder(story("a", "2026-08-01", 3), 0)).toBe(3);
    expect(seriesPartOrder(story("b", "2026-08-01"), 1)).toBe(2);
  });

  // The first ungrouped story becomes the full-width feature, so the list must
  // lead with the newest one whichever group it was folded in from.
  it("orders ungrouped stories newest first without mutating the input", () => {
    const input = [
      story("older", "2026-07-01"),
      story("newest", "2026-08-20"),
      story("middle", "2026-08-01"),
    ];

    expect(orderUngrouped(input).map((entry) => entry.slug)).toEqual([
      "newest",
      "middle",
      "older",
    ]);
    expect(input.map((entry) => entry.slug)).toEqual([
      "older",
      "newest",
      "middle",
    ]);
  });
});
