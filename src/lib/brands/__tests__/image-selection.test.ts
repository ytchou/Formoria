import { describe, expect, it } from "vitest";

import { selectBrandCardImage } from "../image-selection";

// Images are addressed through the same-origin image proxy. DEV-1551 emptied
// ALLOWED_IMAGE_HOSTS, so an absolute remote URL now resolves to null.
const logoUrl = "/i/brands/atelier/logo.png";
const productUrl = "/i/brands/atelier/ceramic-cup.jpg";

describe("selectBrandCardImage", () => {
  it("chooses the first non-logo product photo with its aligned metadata", () => {
    const logoMeta = {
      altZh: "品牌標誌",
      altEn: "Brand logo",
      isLogo: true,
    };
    const productMeta = {
      altZh: "陶瓷杯",
      altEn: "Ceramic cup",
      isLogo: false,
    };

    expect(
      selectBrandCardImage({
        heroImageUrl: logoUrl,
        productPhotos: [productUrl],
        imageAlts: [logoMeta, productMeta],
      }),
    ).toEqual({ src: productUrl, meta: productMeta });
  });
});
