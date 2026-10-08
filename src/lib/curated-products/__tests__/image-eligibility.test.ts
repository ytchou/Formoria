import { describe, expect, it } from "vitest";

import {
  canPublishCuratedProduct,
  hasRenderableCuratedImage,
} from "../image-eligibility";

describe("hasRenderableCuratedImage", () => {
  it("accepts a mirrored same-origin image path", () => {
    expect(hasRenderableCuratedImage("/i/curated-products/brand/mug.webp")).toBe(
      true,
    );
  });

  it.each([null, undefined, "", "   "])(
    "rejects a missing image (%s)",
    (value) => {
      expect(hasRenderableCuratedImage(value)).toBe(false);
    },
  );

  it.each([
    // Protocol-relative: starts with `/` but fetches offsite.
    "//evil.example/mug.jpg",
    // A host outside the allow-list renders as the letter placeholder.
    "https://images.example.com/mug.jpg",
    "javascript:alert(1)",
  ])("rejects a URL the tile would not render (%s)", (value) => {
    expect(hasRenderableCuratedImage(value)).toBe(false);
  });
});

describe("canPublishCuratedProduct", () => {
  it("publishes a row with a renderable image", () => {
    expect(
      canPublishCuratedProduct({
        imageUrl: "/i/curated-products/brand/mug.webp",
        imageSourceUrl: null,
      }),
    ).toBe(true);
  });

  it("publishes a row whose image is still waiting to be mirrored", () => {
    // The generated pipeline publishes BEFORE the mirror runs; the public reads
    // hide the row until `image_url` lands.
    expect(
      canPublishCuratedProduct({
        imageUrl: null,
        imageSourceUrl: "https://shop.example.com/mug.jpg",
      }),
    ).toBe(true);
  });

  it.each([
    { imageUrl: null, imageSourceUrl: null },
    { imageUrl: undefined, imageSourceUrl: undefined },
    { imageUrl: "", imageSourceUrl: "  " },
    { imageUrl: "//evil.example/mug.jpg", imageSourceUrl: null },
  ])("refuses a row with no image at all (%o)", (fields) => {
    expect(canPublishCuratedProduct(fields)).toBe(false);
  });
});
