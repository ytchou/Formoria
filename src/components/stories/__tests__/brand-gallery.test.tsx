// @vitest-environment jsdom
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import enMessages from "../../../../messages/en.json";
import type { Brand } from "@/lib/types";

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

import { BrandGallery } from "../brand-gallery";

const imageUrl = (name: string) =>
  `https://xyz.supabase.co/storage/v1/object/public/brand-images/${name}.jpg`;

function makeBrand(
  slug: string,
  name: string,
  heroImageUrl: string | null = imageUrl("hero"),
  productPhotos: string[] = [],
  imageAlts: Array<{ altZh: string | null; altEn: string | null }> = [],
): Brand {
  return {
    id: `id-${slug}`,
    name,
    slug,
    status: "approved",
    category: "bags-accessories",
    productType: "bags-accessories",
    heroImageUrl,
    productPhotos,
    imageAlts,
    heroImageMetadata: null,
    blurb: "Directory blurb",
    blurbEn: "Directory blurb",
    description: null,
    descriptionEn: null,
    isVerified: false,
    mitStatus: "unverified",
    priceRange: null,
    productTags: [],
    productTagsEn: [],
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
  imageAlts: Array<{ altZh: string | null; altEn: string | null }> = [],
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

    const notice = screen.getByText("Brand unavailable: ghost-brand");
    expect(notice.className).toContain("border-dashed");
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
            [{ altZh: null, altEn: "A product hero" }],
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

    const uncoveredImage = screen.getByRole("img", {
      name: "Molasses product photo",
    });
    expect(uncoveredImage).not.toHaveAttribute("alt", "");
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
