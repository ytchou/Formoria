import { describe, expect, it } from "vitest";
import { reviewQueue } from "./review";
import type { GoldenImageEntry } from "./types";

function entry(id: string, split: "dev" | "holdout"): GoldenImageEntry {
  return {
    id,
    brandId: `brand-${id}`,
    brandSlug: `brand-${id}`,
    brandName: `Brand ${id}`,
    category: "fashion",
    split,
    query: "brand",
    position: 1,
    sourceUrl: `https://example.com/${id}.jpg`,
    fetchUrl: null,
    pageUrl: null,
    previewUrl: null,
    title: id,
    source: "example.com",
    domain: "example.com",
    providerWidth: 100,
    providerHeight: 100,
    thumbnailWidth: 100,
    thumbnailHeight: 100,
    googleUrl: null,
    captureStatus: "ready",
    failureReason: null,
    objectPath: `image-eval/${id}.webp`,
    checksumSha256: id,
    contentType: "image/webp",
    width: 100,
    height: 100,
    bytes: 100,
  };
}

describe("review queue", () => {
  it("randomizes deterministically with dev images before the partial holdout", () => {
    const entries = [
      entry("holdout-1", "holdout"),
      entry("dev-1", "dev"),
      entry("dev-2", "dev"),
      entry("holdout-2", "holdout"),
      entry("dev-3", "dev"),
    ];
    const first = reviewQueue(entries, 1);
    const second = reviewQueue(entries.toReversed(), 1);

    expect(first).toEqual(second);
    expect(first).toHaveLength(4);
    expect(first.slice(0, 3).every((item) => item.split === "dev")).toBe(true);
    expect(first.at(-1)?.split).toBe("holdout");
  });

  it("fails closed when the requested holdout sample is unavailable", () => {
    expect(() => reviewQueue([entry("dev-1", "dev")], 1)).toThrow(
      "Review queue needs 1 holdout images",
    );
  });
});
