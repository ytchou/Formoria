import { describe, expect, it } from "vitest";
import { parseSerperImageCandidates } from "../serper";

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
