import { describe, it, expect } from "vitest";
import {
  deriveBrandTrailLinks,
  deriveBrandStoryLinks,
  deriveCategoryEditorialLinks,
  deriveProductTrailLinks,
  deriveStoryRelatedTrails,
} from "../editorial-links";

// ---------------------------------------------------------------------------
// Fixtures — pure data, no Supabase
// ---------------------------------------------------------------------------

// A minimal curated product placement record
type ProductPlacement = {
  brandSlug: string;
  productKey: string;
  trailSlug: string;
  trailTitle: string;
  trailLocale: string;
  category: string;
  subcategories: string[];
};

// A minimal story brands record
type StoryBrandsRecord = {
  slug: string;
  title: string;
  locale: string;
  brands: string[];
};

// ---------------------------------------------------------------------------
// deriveBrandTrailLinks
// ---------------------------------------------------------------------------

describe("deriveBrandTrailLinks", () => {
  it("returns distinct trail links for a brand with curated products", () => {
    const placements: ProductPlacement[] = [
      {
        brandSlug: "yuyu",
        productKey: "p",
        trailSlug: "small-space-reading-corner",
        trailTitle: "小坪數閱讀角落",
        trailLocale: "zh-TW",
        category: "home",
        subcategories: [],
      },
      {
        brandSlug: "yuyu",
        productKey: "p",
        trailSlug: "small-space-reading-corner",
        trailTitle: "小坪數閱讀角落",
        trailLocale: "zh-TW",
        category: "home",
        subcategories: [],
      },
      {
        brandSlug: "other-brand",
        productKey: "p",
        trailSlug: "another-trail",
        trailTitle: "Another Trail",
        trailLocale: "zh-TW",
        category: "fashion",
        subcategories: [],
      },
    ];

    const result = deriveBrandTrailLinks("yuyu", placements);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      slug: "small-space-reading-corner",
      title: "小坪數閱讀角落",
      locale: "zh-TW",
    });
  });

  it("returns empty for a brand with no appearances", () => {
    const placements: ProductPlacement[] = [
      {
        brandSlug: "other-brand",
        productKey: "p",
        trailSlug: "some-trail",
        trailTitle: "Some Trail",
        trailLocale: "zh-TW",
        category: "home",
        subcategories: [],
      },
    ];

    const result = deriveBrandTrailLinks("yuyu", placements);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// deriveBrandStoryLinks
// ---------------------------------------------------------------------------

describe("deriveBrandStoryLinks", () => {
  it("returns story links for a brand referenced in story frontmatter", () => {
    const stories: StoryBrandsRecord[] = [
      {
        slug: "2026-08-03-2026-taiwan-creative-expo-category-guide",
        title: "2026 文博會精選",
        locale: "zh-TW",
        brands: ["yuyu", "ziliaoshi", "pang"],
      },
      {
        slug: "2026-08-06-craft-brands",
        title: "工藝品牌",
        locale: "zh-TW",
        brands: ["huiaio-studio", "simply-made"],
      },
    ];

    const result = deriveBrandStoryLinks("yuyu", stories);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      slug: "2026-08-03-2026-taiwan-creative-expo-category-guide",
      title: "2026 文博會精選",
      locale: "zh-TW",
    });
  });

  it("returns empty for a brand with no story mentions", () => {
    const stories: StoryBrandsRecord[] = [
      {
        slug: "some-story",
        title: "Some Story",
        locale: "zh-TW",
        brands: ["other-brand"],
      },
    ];

    const result = deriveBrandStoryLinks("yuyu", stories);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// deriveCategoryEditorialLinks
// ---------------------------------------------------------------------------

describe("deriveCategoryEditorialLinks", () => {
  it("returns trail and story slugs whose brands fall within the category", () => {
    const placements: ProductPlacement[] = [
      {
        brandSlug: "yuyu",
        productKey: "p",
        trailSlug: "small-space-reading-corner",
        trailTitle: "小坪數閱讀角落",
        trailLocale: "zh-TW",
        category: "home",
        subcategories: ["candles"],
      },
      {
        brandSlug: "pang",
        productKey: "p",
        trailSlug: "another-trail",
        trailTitle: "Another",
        trailLocale: "zh-TW",
        category: "fashion",
        subcategories: [],
      },
    ];

    const stories: StoryBrandsRecord[] = [
      {
        slug: "expo-guide",
        title: "Expo Guide",
        locale: "zh-TW",
        brands: ["yuyu", "pang"],
      },
    ];

    // Brands in the "home" category
    const brandsByCategory = new Map([
      ["home", ["yuyu"]],
      ["fashion", ["pang"]],
    ]);

    const result = deriveCategoryEditorialLinks(
      "home",
      undefined,
      placements,
      stories,
      brandsByCategory,
    );

    expect(result.trails).toHaveLength(1);
    expect(result.trails[0]!.slug).toBe("small-space-reading-corner");
    expect(result.stories).toHaveLength(1);
    expect(result.stories[0]!.slug).toBe("expo-guide");
  });

  it("returns empty when no brands match the category", () => {
    const result = deriveCategoryEditorialLinks(
      "tech",
      undefined,
      [],
      [],
      new Map(),
    );
    expect(result.trails).toEqual([]);
    expect(result.stories).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// deriveStoryRelatedTrails
// ---------------------------------------------------------------------------

describe("deriveStoryRelatedTrails", () => {
  it("returns trail slugs sharing brands with the story", () => {
    const storyBrands = ["yuyu", "pang"];
    const placements: ProductPlacement[] = [
      {
        brandSlug: "yuyu",
        productKey: "p",
        trailSlug: "small-space-reading-corner",
        trailTitle: "小坪數閱讀角落",
        trailLocale: "zh-TW",
        category: "home",
        subcategories: [],
      },
      {
        brandSlug: "other",
        productKey: "p",
        trailSlug: "unrelated-trail",
        trailTitle: "Unrelated",
        trailLocale: "zh-TW",
        category: "fashion",
        subcategories: [],
      },
    ];

    const result = deriveStoryRelatedTrails(storyBrands, placements);
    expect(result).toHaveLength(1);
    expect(result[0]!.slug).toBe("small-space-reading-corner");
  });

  it("returns empty when story brands have no trail placements", () => {
    const result = deriveStoryRelatedTrails(["brand-x"], []);
    expect(result).toEqual([]);
  });
});


// ---------------------------------------------------------------------------
// deriveProductTrailLinks
// ---------------------------------------------------------------------------

describe("deriveProductTrailLinks", () => {
  function placement(
    overrides: Partial<ProductPlacement>,
  ): ProductPlacement {
    return {
      brandSlug: "yuyu",
      productKey: "lamp",
      trailSlug: "reading-corner",
      trailTitle: "小坪數閱讀角落",
      trailLocale: "zh-TW",
      category: "home",
      subcategories: [],
      ...overrides,
    };
  }

  it("maps each of the brand's products to its first trail, in placement order", () => {
    const result = deriveProductTrailLinks("yuyu", [
      placement({}),
      placement({ trailSlug: "later-trail", trailTitle: "Later" }),
      placement({ productKey: "mug", trailSlug: "tea", trailTitle: "Tea" }),
    ]);

    expect(result).toEqual({
      lamp: {
        slug: "reading-corner",
        title: "小坪數閱讀角落",
        locale: "zh-TW",
      },
      mug: { slug: "tea", title: "Tea", locale: "zh-TW" },
    });
  });

  it("ignores other brands' placements", () => {
    const result = deriveProductTrailLinks("yuyu", [
      placement({ brandSlug: "other-brand", productKey: "chair" }),
    ]);

    expect(result).toEqual({});
  });

  it("returns an empty map for no placements", () => {
    expect(deriveProductTrailLinks("yuyu", [])).toEqual({});
  });
});
