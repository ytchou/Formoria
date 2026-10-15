import { describe, expect, it } from "vitest";

import type { StoryEntry } from "@/lib/services/stories";
import { orderUngrouped, seriesPartOrder, splitHubLead } from "../page";

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

  // Ungrouped stories read newest first, whichever group they were folded in
  // from.
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
  // EL-14: the newest story of the whole hub leads as the full-width feature,
  // whichever series it belongs to; everything else is grouped below it.
  it("leads with the newest story and passes the rest on, newest first", () => {
    const input = [
      story("older", "2026-07-01"),
      story("newest", "2026-08-20"),
      story("middle", "2026-08-01"),
    ];

    const { lead, rest } = splitHubLead(input);
    expect(lead?.slug).toBe("newest");
    expect(rest.map((entry) => entry.slug)).toEqual(["middle", "older"]);
  });

  it("renders a lone story as only the lead, and no lead with no stories", () => {
    expect(splitHubLead([story("only", "2026-08-01")])).toEqual({
      lead: story("only", "2026-08-01"),
      rest: [],
    });
    expect(splitHubLead([])).toEqual({ lead: null, rest: [] });
  });
});
