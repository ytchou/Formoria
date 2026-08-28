import { describe, it, expect } from "vitest";
import {
  deriveBrandTrailLinks,
  deriveBrandStoryLinks,
  deriveCategoryEditorialLinks,
  deriveStoryRelatedTrails,
  deriveTrailRelatedContent,
} from "../editorial-links";

// ---------------------------------------------------------------------------
// Fixtures — pure data, no Supabase
// ---------------------------------------------------------------------------

// A minimal curated product placement record
type ProductPlacement = {
  brandSlug: string;
  trailSlug: string;
  trailTitle: string;
  category: string;
  subcategories: string[];
};

// A minimal story brands record
type StoryBrandsRecord = {
  slug: string;
  title: string;
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
        trailSlug: "small-space-reading-corner",
        trailTitle: "小坪數閱讀角落",
        category: "home",
        subcategories: [],
      },
      {
        brandSlug: "yuyu",
        trailSlug: "small-space-reading-corner",
        trailTitle: "小坪數閱讀角落",
        category: "home",
        subcategories: [],
      },
      {
        brandSlug: "other-brand",
        trailSlug: "another-trail",
        trailTitle: "Another Trail",
        category: "fashion",
        subcategories: [],
      },
    ];

    const result = deriveBrandTrailLinks("yuyu", placements);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      slug: "small-space-reading-corner",
      title: "小坪數閱讀角落",
    });
  });

  it("returns empty for a brand with no appearances", () => {
    const placements: ProductPlacement[] = [
      {
        brandSlug: "other-brand",
        trailSlug: "some-trail",
        trailTitle: "Some Trail",
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
        brands: ["yuyu", "ziliaoshi", "pang"],
      },
      {
        slug: "2026-08-06-craft-brands",
        title: "工藝品牌",
        brands: ["huiaio-studio", "simply-made"],
      },
    ];

    const result = deriveBrandStoryLinks("yuyu", stories);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      slug: "2026-08-03-2026-taiwan-creative-expo-category-guide",
      title: "2026 文博會精選",
    });
  });

  it("returns empty for a brand with no story mentions", () => {
    const stories: StoryBrandsRecord[] = [
      {
        slug: "some-story",
        title: "Some Story",
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
        trailSlug: "small-space-reading-corner",
        trailTitle: "小坪數閱讀角落",
        category: "home",
        subcategories: ["candles"],
      },
      {
        brandSlug: "pang",
        trailSlug: "another-trail",
        trailTitle: "Another",
        category: "fashion",
        subcategories: [],
      },
    ];

    const stories: StoryBrandsRecord[] = [
      {
        slug: "expo-guide",
        title: "Expo Guide",
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
        trailSlug: "small-space-reading-corner",
        trailTitle: "小坪數閱讀角落",
        category: "home",
        subcategories: [],
      },
      {
        brandSlug: "other",
        trailSlug: "unrelated-trail",
        trailTitle: "Unrelated",
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
// deriveTrailRelatedContent
// ---------------------------------------------------------------------------

describe("deriveTrailRelatedContent", () => {
  it("returns category slugs and story slugs related to the trail's brands", () => {
    const trailPlacements: ProductPlacement[] = [
      {
        brandSlug: "yuyu",
        trailSlug: "small-space-reading-corner",
        trailTitle: "小坪數閱讀角落",
        category: "home",
        subcategories: ["candles"],
      },
      {
        brandSlug: "pang",
        trailSlug: "small-space-reading-corner",
        trailTitle: "小坪數閱讀角落",
        category: "beauty",
        subcategories: [],
      },
    ];

    const stories: StoryBrandsRecord[] = [
      {
        slug: "expo-guide",
        title: "Expo Guide",
        brands: ["yuyu", "other-brand"],
      },
      {
        slug: "unrelated",
        title: "Unrelated",
        brands: ["no-match"],
      },
    ];

    const result = deriveTrailRelatedContent(trailPlacements, stories);

    expect(result.categories).toHaveLength(2);
    const categorySlugs = result.categories.map((c) => c.slug).sort();
    expect(categorySlugs).toEqual(["beauty", "home"]);

    expect(result.stories).toHaveLength(1);
    expect(result.stories[0]!.slug).toBe("expo-guide");
  });

  it("returns empty when trail has no placements", () => {
    const result = deriveTrailRelatedContent([], []);
    expect(result.categories).toEqual([]);
    expect(result.stories).toEqual([]);
  });
});
