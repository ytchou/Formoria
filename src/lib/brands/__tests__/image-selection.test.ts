import { describe, expect, it } from "vitest";

import { selectBrandCardImage } from "../image-selection";

// Images are addressed through the same-origin image proxy. DEV-1551 emptied
// ALLOWED_IMAGE_HOSTS, so an absolute remote URL now resolves to null.
const imageUrl = "/i/brands/atelier/logo.png";
const productUrl = "/i/brands/atelier/ceramic-cup.jpg";

describe("selectBrandCardImage", () => {
  it("chooses the first non-logo product photo with its aligned metadata", () => {
    const logoMeta = {
      isLogo: true,
    };
    const productMeta = {
      isLogo: false,
    };

    expect(
      selectBrandCardImage({
        heroImageUrl: imageUrl,
        productPhotos: [productUrl],
        imageAlts: [logoMeta, productMeta],
      }),
    ).toEqual({ src: productUrl, meta: productMeta });
  });
});
