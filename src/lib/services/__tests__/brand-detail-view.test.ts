import { describe, expect, it } from "vitest";
import type { PublicBrandDetail } from "@/lib/brands/contracts";
import type { Stockist } from "@/lib/types";
import {
  brandCategoryTag,
  brandMakesLabels,
  buildBrandChannelSlots,
  buildBrandDetailView,
  localizedDescription,
  topStockistCities,
  type BrandDetailViewInput,
} from "@/lib/services/brand-detail-view";

// The common case first: a visible-category brand with a two-sentence story in
// both languages, a city, a founding year, and an official site.
function buildBrand(
  overrides: Partial<PublicBrandDetail> = {},
): PublicBrandDetail {
  return {
    id: "0f2a2f6c-7a9e-4a7f-9d64-9f2b1c5f0a11",
    name: "Harbor Form",
    slug: "harbor-form",
    romanizedName: null,
    description:
      "港形是一個來自台北的包袋品牌。\n\n每一個包都在工作室裡手工縫製。",
    descriptionEn:
      "Harbor Form is a bag brand from Taipei.\n\nEvery bag is hand-stitched in the studio.",
    blurb: "台北手工包袋",
    blurbEn: "Hand-stitched bags from Taipei",
    heroImageUrl: null,
    status: "approved",
    categorySlug: "bags-accessories",
    categoryLabel: "包袋配件",
    subcategories: [],
    subcategoriesEn: [],
    foundingYear: 2015,
    city: "taipei",
    productPhotos: [],
    imageAlts: [],
    heroImageMetadata: null,
    purchaseWebsite: "https://harbor.example",
    purchasePinkoi: null,
    purchaseShopee: null,
    purchaseMyship: null,
    socialInstagram: "https://www.instagram.com/harbor",
    socialThreads: null,
    socialFacebook: null,
    otherUrls: [],
    ...overrides,
  };
}

function buildStockist(
  id: string,
  regionLabel: string | null,
  overrides: Partial<Stockist> = {},
): Stockist {
  return {
    id,
    name: `Shop ${id}`,
    regionLabel,
    address: null,
    url: null,
    country: "TW",
    ownerStatus: "confirmed",
    source: "import",
    status: "confirmed",
    ...overrides,
  };
}

function buildInput(
  overrides: Partial<BrandDetailViewInput> = {},
): BrandDetailViewInput {
  return {
    brand: buildBrand(),
    locale: "zh-TW",
    cityLabel: "台北",
    directoryLabel: "品牌目錄",
    curatedCount: 3,
    curatedSubcategories: ["tote-bags", "tote-bags", "backpacks"],
    stockists: {
      confirmed: [buildStockist("a", "臺北市"), buildStockist("b", "台中市")],
      possible: [buildStockist("c", "台北市", { status: "unconfirmed" })],
    },
    hasEditorialAppearances: true,
    faqItemCount: 2,
    ...overrides,
  };
}

describe("localizedDescription", () => {
  it("reads the zh story on zh pages", () => {
    expect(localizedDescription(buildBrand(), "zh-TW")).toBe(
      buildBrand().description,
    );
  });

  it("reads the en story on en pages", () => {
    expect(localizedDescription(buildBrand(), "en")).toBe(
      buildBrand().descriptionEn,
    );
  });

  it("falls back to the zh story when no en story exists", () => {
    expect(
      localizedDescription(buildBrand({ descriptionEn: null }), "en"),
    ).toBe(buildBrand().description);
  });

  it("never reads the en story on zh pages", () => {
    expect(
      localizedDescription(buildBrand({ description: null }), "zh-TW"),
    ).toBeNull();
  });
});

describe("brandCategoryTag", () => {
  it("returns the visible L1 category", () => {
    expect(brandCategoryTag("bags-accessories")).toEqual({
      slug: "bags-accessories",
      name: "Bags & Accessories",
      nameZh: "包袋配件",
    });
  });

  it("hides a deferred category", () => {
    expect(brandCategoryTag("food-drink")).toBeNull();
  });

  it("is null for an unknown or missing slug", () => {
    expect(brandCategoryTag("not-a-category")).toBeNull();
    expect(brandCategoryTag(null)).toBeNull();
    expect(brandCategoryTag(undefined)).toBeNull();
  });
});

describe("buildBrandDetailView", () => {
  describe("category", () => {
    it("tags and labels a visible category in the page locale", () => {
      const zh = buildBrandDetailView(buildInput());
      expect(zh.categoryTag?.slug).toBe("bags-accessories");
      expect(zh.categoryLabel).toBe("包袋配件");

      const en = buildBrandDetailView(buildInput({ locale: "en" }));
      expect(en.categoryLabel).toBe("Bags & Accessories");
    });

    it("has no tag for a deferred category, but keeps the L1 name as its label", () => {
      const view = buildBrandDetailView(
        buildInput({ brand: buildBrand({ categorySlug: "food-drink" }) }),
      );
      expect(view.categoryTag).toBeNull();
      expect(view.categoryLabel).toBe("食品飲料");
    });

    it("has neither tag nor label without a category", () => {
      const view = buildBrandDetailView(
        buildInput({ brand: buildBrand({ categorySlug: null }) }),
      );
      expect(view.categoryTag).toBeNull();
      expect(view.categoryLabel).toBe("");
    });
  });

  describe("description, lede and story", () => {
    it("splits the zh story into a lede and the remaining paragraphs", () => {
      const view = buildBrandDetailView(buildInput());
      expect(view.description).toBe(buildBrand().description);
      expect(view.lede).toBe("港形是一個來自台北的包袋品牌。");
      expect(view.storyParagraphs).toEqual(["每一個包都在工作室裡手工縫製。"]);
    });

    it("reads the en story on en pages", () => {
      const view = buildBrandDetailView(buildInput({ locale: "en" }));
      expect(view.description).toBe(buildBrand().descriptionEn);
      expect(view.lede).toBe("Harbor Form is a bag brand from Taipei.");
      expect(view.storyParagraphs).toEqual([
        "Every bag is hand-stitched in the studio.",
      ]);
    });

    it("falls back to the zh story on en pages without an en story", () => {
      const view = buildBrandDetailView(
        buildInput({
          locale: "en",
          brand: buildBrand({ descriptionEn: null }),
        }),
      );
      expect(view.description).toBe(buildBrand().description);
    });

    it("leads with the en blurb when the en story has no splittable first sentence", () => {
      const view = buildBrandDetailView(
        buildInput({
          locale: "en",
          brand: buildBrand({ descriptionEn: "Hand-stitched bags" }),
        }),
      );
      expect(view.lede).toBe("Hand-stitched bags from Taipei");
    });

    it("has no lede and no story without a description", () => {
      const view = buildBrandDetailView(
        buildInput({ brand: buildBrand({ description: null }) }),
      );
      expect(view.description).toBeNull();
      expect(view.lede).toBeNull();
      expect(view.storyParagraphs).toBeNull();
    });
  });

  describe("sections", () => {
    it("lists every section in page order for a rich brand", () => {
      const view = buildBrandDetailView(buildInput());
      // Product-led (BD-01): products, then the route out, then the story.
      expect(view.sections).toEqual([
        { id: "selected-products", labelKey: "tabNav.short.selectedProducts" },
        { id: "where-to-buy", labelKey: "tabNav.short.whereToBuy" },
        { id: "about", labelKey: "tabNav.short.about" },
        { id: "featured-in", labelKey: "tabNav.short.featuredIn" },
        { id: "faq", labelKey: "tabNav.short.faq" },
        { id: "social", labelKey: "tabNav.short.social" },
      ]);
    });

    it("keeps only where-to-buy and social for a sparse brand", () => {
      const view = buildBrandDetailView(
        buildInput({
          brand: buildBrand({ description: null }),
          curatedCount: 0,
          hasEditorialAppearances: false,
          faqItemCount: 0,
        }),
      );
      expect(view.sections.map((section) => section.id)).toEqual([
        "where-to-buy",
        "social",
      ]);
    });
  });

  describe("breadcrumb", () => {
    it("names the directory, the category, then the brand", () => {
      const view = buildBrandDetailView(buildInput());
      expect(view.breadcrumb).toEqual([
        { label: "品牌目錄", href: "/brands" },
        { label: "包袋配件", href: "/brands?category=bags-accessories" },
        { label: "Harbor Form" },
      ]);
    });

    it("skips the category crumb when the category is not visible", () => {
      const view = buildBrandDetailView(
        buildInput({ brand: buildBrand({ categorySlug: "food-drink" }) }),
      );
      expect(view.breadcrumb).toEqual([
        { label: "品牌目錄", href: "/brands" },
        { label: "Harbor Form" },
      ]);
    });
  });

  describe("hero facts", () => {
    it("carries city, founding year, the two counts, cities and channels", () => {
      const view = buildBrandDetailView(buildInput());
      expect(view.heroFacts).toEqual({
        cityLabel: "台北",
        foundingYear: 2015,
        selectedCount: 3,
        stockistCount: 3,
        stockistCities: [
          { citySlug: "taipei", count: 2 },
          { citySlug: "taichung", count: 1 },
        ],
        channels: [
          {
            kind: "website",
            labelKey: "links.website",
            url: "https://harbor.example",
            host: "harbor.example",
          },
          {
            kind: "instagram",
            labelKey: "links.instagram",
            url: "https://www.instagram.com/harbor",
            host: "instagram.com",
          },
        ],
      });
      expect(view.hasHeroColophon).toBe(true);
    });

    it("caps the hero route rows at four, jump rows first", () => {
      const brand = buildBrand({
        purchasePinkoi: "https://www.pinkoi.com/store/harbor",
        purchaseShopee: "https://shopee.tw/harbor",
        socialFacebook: "https://www.facebook.com/harbor",
      });
      const rich = buildBrandDetailView(buildInput({ brand }));
      // Two jump rows (products, stockists) leave room for two channels.
      expect(rich.heroFacts.channels.map((slot) => slot.kind)).toEqual([
        "website",
        "pinkoi",
      ]);
      const sparse = buildBrandDetailView(
        buildInput({
          brand,
          curatedCount: 0,
          stockists: { confirmed: [], possible: [] },
        }),
      );
      expect(sparse.heroFacts.channels.map((slot) => slot.kind)).toEqual([
        "website",
        "pinkoi",
        "shopee",
        "instagram",
      ]);
      // Where-to-buy and social still list every channel.
      expect(rich.links.channels.purchase).toHaveLength(3);
      expect(rich.links.channels.social).toHaveLength(2);
    });

    it("has a colophon with only a founding year", () => {
      const view = buildBrandDetailView(buildInput({ cityLabel: null }));
      expect(view.hasHeroColophon).toBe(true);
    });

    it("has no colophon without city or founding year", () => {
      const view = buildBrandDetailView(
        buildInput({
          cityLabel: null,
          brand: buildBrand({ foundingYear: null }),
        }),
      );
      expect(view.hasHeroColophon).toBe(false);
    });
  });

  it("counts confirmed and possible stockists together", () => {
    expect(buildBrandDetailView(buildInput()).stockistCount).toBe(3);
    expect(
      buildBrandDetailView(
        buildInput({ stockists: { confirmed: [], possible: [] } }),
      ).stockistCount,
    ).toBe(0);
  });

  it("routes out to the first known channel", () => {
    expect(buildBrandDetailView(buildInput()).visitLink).toEqual({
      href: "https://harbor.example",
      kind: "website",
    });
    expect(
      buildBrandDetailView(
        buildInput({
          brand: buildBrand({
            purchaseWebsite: null,
            socialInstagram: null,
          }),
        }),
      ).visitLink,
    ).toBeNull();
  });

  it("builds the canonical URL for the page locale", () => {
    expect(buildBrandDetailView(buildInput()).canonical).toMatch(
      /\/brands\/harbor-form$/,
    );
    expect(
      buildBrandDetailView(buildInput({ locale: "en" })).canonical,
    ).toMatch(/\/en\/brands\/harbor-form$/);
  });

  describe("link props", () => {
    it("passes the client link components only the fields they read", () => {
      const view = buildBrandDetailView(buildInput());
      expect(view.links.tracked).toEqual({
        id: "0f2a2f6c-7a9e-4a7f-9d64-9f2b1c5f0a11",
        slug: "harbor-form",
      });
      expect(view.links.channels.purchase.map((slot) => slot.kind)).toEqual([
        "website",
      ]);
      expect(view.links.channels.social.map((slot) => slot.kind)).toEqual([
        "instagram",
      ]);
      // The shelf's route-out fallback reads the visit fields and the slug only.
      expect(view.links.visit).toEqual({
        slug: "harbor-form",
        purchaseWebsite: "https://harbor.example",
        purchasePinkoi: null,
        purchaseShopee: null,
        purchaseMyship: null,
        socialInstagram: "https://www.instagram.com/harbor",
        socialThreads: null,
        socialFacebook: null,
      });
      expect(Object.keys(view.links.corrections).sort()).toEqual(
        [
          "id",
          "slug",
          "purchaseWebsite",
          "purchasePinkoi",
          "purchaseShopee",
          "purchaseMyship",
          "socialInstagram",
          "socialThreads",
          "socialFacebook",
        ].sort(),
      );
      // The story never rides along into a client component's props.
      expect(JSON.stringify(view.links)).not.toContain("港形");
    });

    it("keeps only other links with both a label and a safe URL", () => {
      const view = buildBrandDetailView(
        buildInput({
          brand: buildBrand({
            otherUrls: [
              { label: " Studio blog ", url: "https://blog.harbor.example" },
              { label: "", url: "https://no-label.example" },
              { label: "Unsafe", url: "javascript:alert(1)" },
            ],
          }),
        }),
      );
      expect(view.links.other).toEqual([
        { label: "Studio blog", url: "https://blog.harbor.example" },
      ]);
    });

    it("has no other links when the brand lists none", () => {
      expect(buildBrandDetailView(buildInput()).links.other).toEqual([]);
    });
  });

  describe("makes labels", () => {
    it("names the selected products' subcategories, most products first", () => {
      const view = buildBrandDetailView(
        buildInput({
          curatedSubcategories: ["backpacks", "tote-bags", null, "tote-bags"],
        }),
      );
      expect(view.makesLabels).toEqual(
        brandMakesLabels(["tote-bags", "backpacks"], [], "zh-TW"),
      );
      expect(view.makesLabels).toHaveLength(2);
    });

    it("is empty when neither products nor the brand name a subcategory", () => {
      const view = buildBrandDetailView(
        buildInput({ curatedSubcategories: [] }),
      );
      expect(view.makesLabels).toEqual([]);
    });
  });
});

describe("brandMakesLabels", () => {
  it("orders by product count, ties by first appearance, at most three", () => {
    expect(
      brandMakesLabels(
        ["dresses", "pants", "skirts", "pants", "outerwear", "skirts"],
        [],
        "zh-TW",
      ),
    ).toEqual(["褲裝", "裙裝", "洋裝"]);
  });

  it("labels in the page locale", () => {
    expect(brandMakesLabels(["dresses", "pants"], [], "en")).toEqual([
      "Dresses",
      "Pants",
    ]);
  });

  it("falls back to the brand's own subcategories without product ones", () => {
    expect(
      brandMakesLabels([null, null], ["skirts", "dresses"], "zh-TW"),
    ).toEqual(["裙裝", "洋裝"]);
  });

  it("drops a repeated label", () => {
    expect(brandMakesLabels([], ["skirts", "skirts", "pants"], "en")).toEqual([
      "Skirts",
      "Pants",
    ]);
  });

  it("is empty when nothing is known", () => {
    expect(brandMakesLabels([], [], "zh-TW")).toEqual([]);
  });
});

describe("buildBrandChannelSlots", () => {
  const none = {
    purchaseWebsite: null,
    purchasePinkoi: null,
    purchaseShopee: null,
    purchaseMyship: null,
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
  };

  it("lists every live channel in registry order, then social", () => {
    const slots = buildBrandChannelSlots({
      purchaseWebsite: "harbor.example",
      purchasePinkoi: "https://www.pinkoi.com/store/harbor",
      purchaseShopee: "https://shopee.tw/harbor",
      purchaseMyship: "https://myship.7-11.com.tw/general/detail/GM1",
      socialInstagram: "@harbor",
      socialThreads: "harbor",
      socialFacebook: "https://www.facebook.com/harbor",
    });
    expect(slots.purchase).toEqual([
      {
        kind: "website",
        labelKey: "links.website",
        url: "https://harbor.example",
        host: "harbor.example",
      },
      {
        kind: "pinkoi",
        labelKey: "links.pinkoi",
        url: "https://www.pinkoi.com/store/harbor",
        host: "pinkoi.com",
      },
      {
        kind: "shopee",
        labelKey: "links.shopee",
        url: "https://shopee.tw/harbor",
        host: "shopee.tw",
      },
      {
        kind: "myship",
        labelKey: "links.myship",
        url: "https://myship.7-11.com.tw/general/detail/GM1",
        host: "myship.7-11.com.tw",
      },
    ]);
    expect(slots.social).toEqual([
      {
        kind: "instagram",
        labelKey: "links.instagram",
        url: "https://instagram.com/harbor",
        host: "instagram.com",
      },
      {
        kind: "threads",
        labelKey: "links.threads",
        url: "https://threads.net/@harbor",
        host: "threads.net",
      },
      {
        kind: "facebook",
        labelKey: "links.facebook",
        url: "https://www.facebook.com/harbor",
        host: "facebook.com",
      },
    ]);
  });

  it("names a marketplace URL in the website field by where it goes", () => {
    const slots = buildBrandChannelSlots({
      ...none,
      purchaseWebsite: "https://shopee.tw/harbor",
    });
    expect(slots.purchase).toEqual([
      {
        kind: "shopee",
        labelKey: "links.shopee",
        url: "https://shopee.tw/harbor",
        host: "shopee.tw",
      },
    ]);
  });

  it("drops a channel without a usable URL", () => {
    const slots = buildBrandChannelSlots({
      ...none,
      purchasePinkoi: "javascript:alert(1)",
      socialThreads: "   ",
    });
    expect(slots).toEqual({ purchase: [], social: [] });
  });
});

describe("topStockistCities", () => {
  it("names the two cities with the most stockists, folding 臺 to 台", () => {
    expect(
      topStockistCities([
        buildStockist("1", "台中市"),
        buildStockist("2", "臺中市"),
        buildStockist("3", "台北市"),
        buildStockist("4", "高雄市"),
        buildStockist("5", "高雄市"),
        buildStockist("6", "高雄市"),
      ]),
    ).toEqual([
      { citySlug: "kaohsiung", count: 3 },
      { citySlug: "taichung", count: 2 },
    ]);
  });

  it("never names a chain, an overseas or an unmapped location as a city", () => {
    expect(
      topStockistCities([
        buildStockist("1", "全台多間門市"),
        buildStockist("2", "東京", { country: "JP" }),
        buildStockist("3", null),
        buildStockist("4", "台南市"),
      ]),
    ).toEqual([{ citySlug: "tainan", count: 1 }]);
  });

  it("is empty without stockists", () => {
    expect(topStockistCities([])).toEqual([]);
  });
});
