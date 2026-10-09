// @vitest-environment jsdom
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import enMessages from "../../../../messages/en.json";
import type { Brand } from "@/lib/types";
import type { BrandImageMeta } from "@/lib/types/brand";

const loadBrands = vi.fn<(slugs: string[]) => Promise<Map<string, Brand>>>();

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../../../messages/en.json")).default;

  type TranslatorOptions = Parameters<typeof createTranslator>[0];

  const getTranslations = async (
    options?: string | { locale?: string; namespace?: string },
  ) =>
    createTranslator({
      locale: typeof options === "string" ? "en" : (options?.locale ?? "en"),
      messages,
      namespace: typeof options === "string" ? options : options?.namespace,
    } as unknown as TranslatorOptions);

  return {
    getLocale: async () => "en",
    getTranslations,
  };
});

import { BrandGallery, galleryColumns } from "../brand-gallery";

const imageUrl = (name: string) => `/i/brands/${name}.jpg`;

function makeBrand(
  slug: string,
  name: string,
  heroImageUrl: string | null = imageUrl("hero"),
  productPhotos: string[] = [],
  imageAlts: BrandImageMeta[] = [],
): Brand {
  return {
    id: `id-${slug}`,
    name,
    slug,
    status: "approved",
    category: "bags-accessories",
    categorySlug: "bags-accessories",
    heroImageUrl,
    productPhotos,
    imageAlts,
    heroImageMetadata: null,
    blurb: "Directory blurb",
    blurbEn: "Directory blurb",
    description: null,
    descriptionEn: null,
    subcategories: [],
    subcategoriesEn: [],
  } as unknown as Brand;
}

/**
 * Stands in for `getBrandImageFields` — the `brand_images` read the gallery
 * makes because the brand row it gets from `loadBrands` carries only the hero.
 * Returning empty fields exercises the fall-back-to-the-brand-row path.
 */
function makeImageFields(
  heroImageUrl: string | null = null,
  productPhotos: string[] = [],
  imageAlts: BrandImageMeta[] = [],
) {
  return async () => ({
    heroImageUrl,
    heroImageMetadata: null,
    productPhotos,
    imageAlts,
  });
}

function renderWithIntl(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("BrandGallery", () => {
  beforeEach(() => {
    loadBrands.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders only the first four gallery images", async () => {
    const hero = imageUrl("hero");
    const products = ["one", "two", "three", "four"].map(imageUrl);
    loadBrands.mockResolvedValue(
      new Map([
        ["molasses", makeBrand("molasses", "Molasses", hero, products, [])],
      ]),
    );

    renderWithIntl(
      await BrandGallery({
        slug: "molasses",
        loadBrands,
        loadImages: makeImageFields(),
      }),
    );

    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(4);
    expect(images.map((image) => image.getAttribute("src"))).not.toContain(
      imageUrl("four"),
    );
  });

  it("fills the grid from brand_images when the brand row carries only a hero", async () => {
    loadBrands.mockResolvedValue(
      new Map([
        ["molasses", makeBrand("molasses", "Molasses", imageUrl("hero"), [])],
      ]),
    );

    renderWithIntl(
      await BrandGallery({
        slug: "molasses",
        loadBrands,
        loadImages: makeImageFields(imageUrl("hero"), [
          imageUrl("one"),
          imageUrl("two"),
          imageUrl("three"),
        ]),
      }),
    );

    expect(screen.getAllByRole("img")).toHaveLength(4);
  });

  it("renders two images when the gallery has two images", async () => {
    loadBrands.mockResolvedValue(
      new Map([
        [
          "molasses",
          makeBrand("molasses", "Molasses", imageUrl("hero"), [
            imageUrl("one"),
          ]),
        ],
      ]),
    );

    renderWithIntl(
      await BrandGallery({
        slug: "molasses",
        loadBrands,
        loadImages: makeImageFields(),
      }),
    );

    expect(screen.getAllByRole("img")).toHaveLength(2);
  });

  it("renders nothing when there are no usable images", async () => {
    loadBrands.mockResolvedValue(
      new Map([["molasses", makeBrand("molasses", "Molasses", null, [])]]),
    );

    const { container } = renderWithIntl(
      await BrandGallery({
        slug: "molasses",
        loadBrands,
        loadImages: makeImageFields(),
      }),
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("drops images from disallowed hosts", async () => {
    loadBrands.mockResolvedValue(
      new Map([
        [
          "molasses",
          makeBrand("molasses", "Molasses", "https://evil.example.com/a.jpg", [
            imageUrl("one"),
          ]),
        ],
      ]),
    );

    renderWithIntl(
      await BrandGallery({
        slug: "molasses",
        loadBrands,
        loadImages: makeImageFields(),
      }),
    );

    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByRole("img")).toHaveAttribute("src", imageUrl("one"));
  });

  it("renders a missing-brand notice for an unresolvable slug", async () => {
    loadBrands.mockResolvedValue(new Map());

    renderWithIntl(
      await BrandGallery({
        slug: "ghost-brand",
        loadBrands,
        loadImages: makeImageFields(),
      }),
    );

    const notice = screen.getByText("This brand doesn't have a public page right now");
    expect(notice.className).toContain("border-dashed");
    // CP2-24: the notice never prints the raw slug.
    expect(screen.queryByText(/ghost-brand/)).toBeNull();
  });

  // DEV-1963: the notice is an authoring aid. A production build that is not
  // staging drops the gallery; staging keeps the notice so editors see it.
  it("renders nothing for an unresolvable slug in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FORMORIA_DEPLOYMENT_ENV", "");
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "");
    vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT_ENV", "");
    loadBrands.mockResolvedValue(new Map());

    const { container } = renderWithIntl(
      await BrandGallery({
        slug: "ghost-brand",
        loadBrands,
        loadImages: makeImageFields(),
      }),
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders the missing-brand notice on staging", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "staging");
    loadBrands.mockResolvedValue(new Map());

    renderWithIntl(
      await BrandGallery({
        slug: "ghost-brand",
        loadBrands,
        loadImages: makeImageFields(),
      }),
    );

    expect(
      screen.getByText("This brand doesn't have a public page right now"),
    ).toBeInTheDocument();
  });

  it("uses a generic alt when imageAlts is shorter than the image list", async () => {
    loadBrands.mockResolvedValue(
      new Map([
        [
          "molasses",
          makeBrand(
            "molasses",
            "Molasses",
            imageUrl("hero"),
            [imageUrl("one")],
            [{ isLogo: false }],
          ),
        ],
      ]),
    );

    renderWithIntl(
      await BrandGallery({
        slug: "molasses",
        loadBrands,
        loadImages: makeImageFields(),
      }),
    );

    const uncoveredImages = screen.getAllByRole("img", {
      name: "Molasses product photo",
    });
    expect(uncoveredImages.length).toBeGreaterThanOrEqual(1);
    expect(uncoveredImages[0]).not.toHaveAttribute("alt", "");
  });

  it("renders altZh when available", async () => {
    loadBrands.mockResolvedValue(
      new Map([["molasses", makeBrand("molasses", "Molasses")]]),
    );

    renderWithIntl(
      await BrandGallery({
        slug: "molasses",
        loadBrands,
        loadImages: makeImageFields(imageUrl("hero"), [imageUrl("one")], [
          { isLogo: false, altZh: "品牌主圖" },
          { isLogo: false, altZh: "產品照片" },
        ]),
      }),
    );

    const imgs = screen.getAllByRole("img");
    expect(imgs[0]).toHaveAttribute("alt", "品牌主圖");
    expect(imgs[1]).toHaveAttribute("alt", "產品照片");
  });

  // DS2-38: a column count that does not divide the image count leaves an
  // empty cell in the grid. Three images go three-up, never 2x2 with a hole.
  it("never leaves an empty grid cell", () => {
    for (const count of [1, 2, 3, 4]) {
      const columns = galleryColumns(count);
      expect(count % columns, `${count} images in ${columns} columns`).toBe(0);
    }
  });

  it("lays three images out three-up", async () => {
    loadBrands.mockResolvedValue(
      new Map([
        [
          "molasses",
          makeBrand("molasses", "Molasses", imageUrl("hero"), [
            imageUrl("one"),
            imageUrl("two"),
          ]),
        ],
      ]),
    );

    renderWithIntl(
      await BrandGallery({
        slug: "molasses",
        loadBrands,
        loadImages: makeImageFields(),
      }),
    );

    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(3);
    expect(images[0].parentElement?.className).toContain("grid-cols-3");
  });

  it("renders an optional caption", async () => {
    loadBrands.mockResolvedValue(
      new Map([["molasses", makeBrand("molasses", "Molasses")]]),
    );

    const { rerender } = renderWithIntl(
      await BrandGallery({
        slug: "molasses",
        caption: "作品集",
        loadBrands,
        loadImages: makeImageFields(),
      }),
    );
    expect(screen.getByText("作品集").tagName).toBe("FIGCAPTION");

    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        {await BrandGallery({
          slug: "molasses",
          loadBrands,
          loadImages: makeImageFields(),
        })}
      </NextIntlClientProvider>,
    );
    expect(screen.queryByText("作品集")).toBeNull();
  });
});
