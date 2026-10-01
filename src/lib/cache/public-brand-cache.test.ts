import { beforeEach, describe, expect, it, vi } from "vitest";

const { revalidatePath, revalidateTag } = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath, revalidateTag }));

import {
  PUBLIC_BRAND_DATA_TAG,
  revalidatePublicBrands,
  revalidatePublicStockists,
  revalidateTrailSurfaces,
} from "./public-brand-cache";

const revalidatedPaths = () => revalidatePath.mock.calls;

describe("revalidatePublicBrands", () => {
  beforeEach(() => vi.clearAllMocks());

  it("invalidates all brand-dependent cached page families once per batch", () => {
    // Bug: an approved brand mutation must invalidate the exact prefixless
    // default-locale cache, not only the localized route that next-intl rewrites.
    revalidatePublicBrands(["niizo", "kiln"]);

    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(revalidateTag).toHaveBeenCalledWith(PUBLIC_BRAND_DATA_TAG, "max");
    expect(revalidatedPaths()).toEqual(
      expect.arrayContaining([
        ["/brands/niizo"],
        ["/en/brands/niizo"],
        ["/brands/kiln"],
        ["/en/brands/kiln"],
        ["/"],
        ["/en"],
        ["/discover"],
        ["/en/discover"],
        ["/about"],
        ["/en/about"],
        ["/sitemap.xml"],
        ["/[locale]/stories/[slug]", "page"],
      ]),
    );
  });

  it("deduplicates slugs and never invalidates dynamic directory or taxonomy paths", () => {
    revalidatePublicBrands(["niizo", " niizo ", "kiln", ""]);

    expect(
      revalidatedPaths().filter(([path]) => path === "/brands/niizo"),
    ).toHaveLength(1);
    expect(revalidatedPaths()).not.toContainEqual(["/zh-TW/brands"]);
    expect(revalidatedPaths()).not.toContainEqual(["/en/brands"]);
    expect(
      revalidatedPaths().some(
        ([path]) => typeof path === "string" && path.startsWith("/categories/"),
      ),
    ).toBe(false);
  });

  it("emits the exact default-locale and English detail paths", () => {
    revalidatePublicBrands(["niizo"]);

    expect(
      revalidatedPaths().filter(
        ([path]) => typeof path === "string" && path.endsWith("/brands/niizo"),
      ),
    ).toEqual([["/brands/niizo"], ["/en/brands/niizo"]]);
    expect(revalidatedPaths()).not.toContainEqual(["/zh-TW/brands/niizo"]);
  });

  it("does nothing for an empty brand batch", () => {
    revalidatePublicBrands([]);

    expect(revalidateTag).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("revalidatePublicStockists", () => {
  beforeEach(() => vi.clearAllMocks());

  it("invalidates the brand data cache tag", () => {
    revalidatePublicStockists();
    expect(revalidateTag).toHaveBeenCalledWith(PUBLIC_BRAND_DATA_TAG, "max");
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("revalidateTrailSurfaces", () => {
  beforeEach(() => vi.clearAllMocks());

  it("revalidates each trail path in every locale plus home and style hub", () => {
    // A trail placement changes the trail page and the peeks on the homepage
    // 風格 section and the /style hub, so all three surfaces must refresh.
    revalidateTrailSurfaces(["x", "y"]);

    expect(revalidatedPaths()).toEqual([
      ["/style/x"],
      ["/en/style/x"],
      ["/style/y"],
      ["/en/style/y"],
      ["/"],
      ["/en"],
      ["/style"],
      ["/en/style"],
    ]);
    expect(revalidatedPaths()).not.toContainEqual(["/zh-TW/style/x"]);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("deduplicates trail slugs and does nothing for an empty batch", () => {
    revalidateTrailSurfaces(["x", " x ", ""]);
    expect(
      revalidatedPaths().filter(([path]) => path === "/style/x"),
    ).toHaveLength(1);

    vi.clearAllMocks();
    revalidateTrailSurfaces([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
