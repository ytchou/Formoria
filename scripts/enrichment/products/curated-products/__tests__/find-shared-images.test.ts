import { describe, expect, it } from "vitest";

import { groupSharedImages, type SharedImageRow } from "../find-shared-images";

/** BD-04 census: products of one brand that share a stored image. */

function row(overrides: Partial<SharedImageRow> = {}): SharedImageRow {
  return {
    id: "id",
    key: "pick",
    name_zh: "商品",
    image_url: "/i/curated-products/pick.webp",
    product_position: null,
    created_at: "2026-08-13T00:00:00Z",
    brands: { slug: "wenwenworks" },
    ...overrides,
  };
}

describe("groupSharedImages", () => {
  it("lists products sharing a content-hash filename, in brand-page order", () => {
    const groups = groupSharedImages([
      row({ key: "chopsticks", name_zh: "鈦筷", image_url: "/i/a/d89b.webp?v=2" }),
      row({ key: "pen-box", name_zh: "筆盒", image_url: "/i/a/d89b.webp", product_position: 1 }),
      row({ key: "own-photo", image_url: "/i/a/own.webp" }),
    ]);

    expect(groups).toEqual([
      {
        brandSlug: "wenwenworks",
        imageIdentity: "d89b.webp",
        products: [
          { key: "pen-box", nameZh: "筆盒", imageUrl: "/i/a/d89b.webp" },
          { key: "chopsticks", nameZh: "鈦筷", imageUrl: "/i/a/d89b.webp?v=2" },
        ],
      },
    ]);
  });

  it("never groups across brands and ignores rows without an image", () => {
    const groups = groupSharedImages([
      row({ key: "a", brands: { slug: "umu" }, image_url: "/i/shared.webp" }),
      row({ key: "b", brands: [{ slug: "zoodi" }], image_url: "/i/shared.webp" }),
      row({ key: "c", image_url: null }),
      row({ key: "d", image_url: null }),
    ]);

    expect(groups).toEqual([]);
  });
});
