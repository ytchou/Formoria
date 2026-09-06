import { describe, expect, it } from "vitest";
import { parseBrandSearchEntries, parseSerperImageCandidates } from "../serper";

describe("raw Serper image parser", () => {
  it("preserves provider metadata before quality filtering", () => {
    const candidates = parseSerperImageCandidates({
      images: [
        {
          imageUrl: "https://cdn.example/image.jpg",
          title: "Product photo",
          link: "https://brand.example/products/1",
          source: "brand.example",
          domain: "brand.example",
          position: 2,
          imageWidth: 1200,
          imageHeight: 800,
          thumbnailUrl: "https://cdn.example/thumb.jpg",
          thumbnailWidth: 300,
          thumbnailHeight: 200,
          googleUrl: "https://www.google.com/imgres",
        },
      ],
    });
    expect(candidates).toEqual([
      {
        imageUrl: "https://cdn.example/image.jpg",
        title: "Product photo",
        link: "https://brand.example/products/1",
        source: "brand.example",
        domain: "brand.example",
        position: 2,
        imageWidth: 1200,
        imageHeight: 800,
        thumbnailUrl: "https://cdn.example/thumb.jpg",
        thumbnailWidth: 300,
        thumbnailHeight: 200,
        googleUrl: "https://www.google.com/imgres",
      },
    ]);
  });

  it("treats a missing image array as empty and rejects malformed entries", () => {
    expect(parseSerperImageCandidates({})).toEqual([]);
    expect(
      parseSerperImageCandidates({ images: [{ title: "missing url" }, null] }),
    ).toEqual([]);
  });
});

describe("raw Serper SERP entry parser", () => {
  it("entries_from_raw_serp_response_rebuilds_titles_and_links", () => {
    // A stored `raw_response` replayed off a `brand_search_results` row must
    // rebuild the same entries the live call produced — titles included, or a
    // handle that only appears in a result TITLE can never match on replay.
    expect(
      parseBrandSearchEntries({
        organic: [
          {
            title: "91art.studio - Art Toys",
            link: "https://shopee.tw/91art.studio-just-ten-i.157651041.19693851041?srsltid=abc",
            snippet: "Shop profile",
            position: 1,
          },
          { title: "Google Search", link: "https://www.google.com/search?q=x" },
          { title: "Blank link", link: "  " },
        ],
      }),
    ).toEqual([
      {
        title: "91art.studio - Art Toys",
        link: "https://shopee.tw/91art.studio-just-ten-i.157651041.19693851041",
        snippet: "Shop profile",
        position: 1,
      },
    ]);
  });

  it("returns no entries for a payload that is not a SERP response", () => {
    expect(parseBrandSearchEntries(null)).toEqual([]);
    expect(parseBrandSearchEntries({ organic: "not-an-array" })).toEqual([]);
    expect(parseBrandSearchEntries({})).toEqual([]);
  });
});
