/**
 * Editorial reverse-linking service.
 *
 * Derives "appears in" relationships between brands, trails, stories, and
 * categories from existing data. All heavy functions are async wrappers that
 * call Supabase + filesystem readers, while the pure derivation helpers are
 * exported for unit testing without mocking.
 */
import { cache } from "react";

import { getPublishedCuratedProductsForTrail } from "@/lib/services/curated-products";
import { getAllStories } from "@/lib/services/stories";
import { getAllTrails } from "@/lib/services/trails";
import { createServiceClient } from "@/lib/supabase/service";

// ---------------------------------------------------------------------------
// Link types
// ---------------------------------------------------------------------------

// `locale` is the content's frontmatter locale, so a page in another locale
// can mark the title with the right `lang`.
export type TrailLink = {
  slug: string;
  title: string;
  locale: string;
};

export type StoryLink = {
  slug: string;
  title: string;
  locale: string;
};

// ---------------------------------------------------------------------------
// Internal data shapes for the pure derivation layer
// ---------------------------------------------------------------------------

type ProductPlacement = {
  brandSlug: string;
  productKey: string;
  trailSlug: string;
  trailTitle: string;
  trailLocale: string;
  category: string;
  subcategories: string[];
};

type StoryBrandsRecord = {
  slug: string;
  title: string;
  locale: string;
  brands: string[];
};

// ---------------------------------------------------------------------------
// Pure derivation helpers (exported for testing — no DB, no filesystem)
// ---------------------------------------------------------------------------

/**
 * Distinct trail links where the given brand has curated product placements.
 */
export function deriveBrandTrailLinks(
  brandSlug: string,
  placements: ProductPlacement[],
): TrailLink[] {
  const seen = new Set<string>();
  const links: TrailLink[] = [];
  for (const p of placements) {
    if (p.brandSlug === brandSlug && !seen.has(p.trailSlug)) {
      seen.add(p.trailSlug);
      links.push({
        slug: p.trailSlug,
        title: p.trailTitle,
        locale: p.trailLocale,
      });
    }
  }
  return links;
}

/**
 * Stories whose `brands` frontmatter includes the given brand slug.
 */
export function deriveBrandStoryLinks(
  brandSlug: string,
  stories: StoryBrandsRecord[],
): StoryLink[] {
  return stories
    .filter((s) => s.brands.includes(brandSlug))
    .map((s) => ({ slug: s.slug, title: s.title, locale: s.locale }));
}

/**
 * Trails and stories whose brands fall within the given category.
 */
export function deriveCategoryEditorialLinks(
  categorySlug: string,
  subcategorySlug: string | undefined,
  placements: ProductPlacement[],
  stories: StoryBrandsRecord[],
  brandsByCategory: Map<string, string[]>,
): { trails: TrailLink[]; stories: StoryLink[] } {
  let brandsInCategory = new Set(brandsByCategory.get(categorySlug) ?? []);
  if (brandsInCategory.size === 0) return { trails: [], stories: [] };

  // When a subcategory is specified, narrow to brands whose placements carry
  // that subcategory tag.
  if (subcategorySlug) {
    const subcategoryBrands = new Set<string>();
    for (const p of placements) {
      if (
        brandsInCategory.has(p.brandSlug) &&
        p.subcategories.includes(subcategorySlug)
      ) {
        subcategoryBrands.add(p.brandSlug);
      }
    }
    brandsInCategory = subcategoryBrands;
    if (brandsInCategory.size === 0) return { trails: [], stories: [] };
  }

  const trailSeen = new Set<string>();
  const trails: TrailLink[] = [];
  for (const p of placements) {
    if (brandsInCategory.has(p.brandSlug) && !trailSeen.has(p.trailSlug)) {
      trailSeen.add(p.trailSlug);
      trails.push({
        slug: p.trailSlug,
        title: p.trailTitle,
        locale: p.trailLocale,
      });
    }
  }

  const storyLinks: StoryLink[] = stories
    .filter((s) => s.brands.some((b) => brandsInCategory.has(b)))
    .map((s) => ({ slug: s.slug, title: s.title, locale: s.locale }));

  return { trails, stories: storyLinks };
}

/**
 * Trails whose curated products belong to the same brands the story references.
 */
export function deriveStoryRelatedTrails(
  storyBrands: string[],
  placements: ProductPlacement[],
): TrailLink[] {
  const brandSet = new Set(storyBrands);
  const seen = new Set<string>();
  const links: TrailLink[] = [];
  for (const p of placements) {
    if (brandSet.has(p.brandSlug) && !seen.has(p.trailSlug)) {
      seen.add(p.trailSlug);
      links.push({
        slug: p.trailSlug,
        title: p.trailTitle,
        locale: p.trailLocale,
      });
    }
  }
  return links;
}

/**
 * The first published trail each of a brand's products appears in, keyed by
 * product key. "First" is placement order, so a product placed in two trails
 * links to one guide, deterministically.
 */
export function deriveProductTrailLinks(
  brandSlug: string,
  placements: ProductPlacement[],
): Record<string, TrailLink> {
  const links: Record<string, TrailLink> = {};
  for (const p of placements) {
    if (p.brandSlug !== brandSlug || p.productKey in links) continue;
    links[p.productKey] = {
      slug: p.trailSlug,
      title: p.trailTitle,
      locale: p.trailLocale,
    };
  }
  return links;
}

// ---------------------------------------------------------------------------
// Async service functions (call DB + filesystem, compose pure helpers)
// ---------------------------------------------------------------------------

/**
 * Collects all published curated product placements across all published trails.
 * Each product is mapped to its brand slug, trail slug/title, and category.
 * Wrapped in React `cache()` so multiple callers in the same request share results.
 */
const collectAllPlacements = cache(
  async (): Promise<ProductPlacement[]> => {
    const trailsResult = await getAllTrails("zh-TW");
    if (!trailsResult.ok) {
      console.error(
        "[editorial-links] getAllTrails returned error — returning empty placements",
      );
      return [];
    }

    const trailProducts = await Promise.all(
      trailsResult.trails.map(async (trail) => {
        try {
          const products = await getPublishedCuratedProductsForTrail(
            trail.slug,
          );
          return products.map(
            (product): ProductPlacement => ({
              brandSlug: product.brandSlug,
              productKey: product.key,
              trailSlug: trail.slug,
              trailTitle: trail.frontmatter.title,
              trailLocale: trail.frontmatter.locale,
              category: product.category,
              subcategories: product.subcategory ? [product.subcategory] : [],
            }),
          );
        } catch {
          return [];
        }
      }),
    );
    return trailProducts.flat();
  },
);

/**
 * Reads all published stories and extracts the `brands` frontmatter field.
 * Wrapped in React `cache()` so multiple callers in the same request share results.
 */
const collectStoryBrands = cache(
  async (): Promise<StoryBrandsRecord[]> => {
    const result = await getAllStories("zh-TW");
    if (!result.ok) return [];
    return result.stories.map((story) => ({
      slug: story.slug,
      title: story.frontmatter.title,
      locale: story.frontmatter.locale,
      brands: story.frontmatter.brands ?? [],
    }));
  },
);

// ---------------------------------------------------------------------------
// Public async API
// ---------------------------------------------------------------------------

export async function getBrandEditorialAppearances(
  brandSlug: string,
): Promise<{ trails: TrailLink[]; stories: StoryLink[] }> {
  const [placements, storyBrands] = await Promise.all([
    collectAllPlacements(),
    collectStoryBrands(),
  ]);
  return {
    trails: deriveBrandTrailLinks(brandSlug, placements),
    stories: deriveBrandStoryLinks(brandSlug, storyBrands),
  };
}

/** Product key → the first published trail (主題選物 guide) placing it. */
export async function getBrandProductTrailLinks(
  brandSlug: string,
): Promise<Record<string, TrailLink>> {
  return deriveProductTrailLinks(brandSlug, await collectAllPlacements());
}

export async function getCategoryEditorialLinks(
  categorySlug: string,
  subcategorySlug?: string,
): Promise<{ trails: TrailLink[]; stories: StoryLink[] }> {
  const [placements, storyBrands] = await Promise.all([
    collectAllPlacements(),
    collectStoryBrands(),
  ]);

  // Build brand→category index from placements
  const brandsByCategory = new Map<string, string[]>();
  for (const p of placements) {
    const list = brandsByCategory.get(p.category) ?? [];
    if (!list.includes(p.brandSlug)) list.push(p.brandSlug);
    brandsByCategory.set(p.category, list);
  }

  // Include brands referenced in stories that have no curated product
  // placements — look up their category from the database.
  const placedBrands = new Set(placements.map((p) => p.brandSlug));
  const unplacedStorySlugs = [
    ...new Set(
      storyBrands.flatMap((s) =>
        s.brands.filter((b) => !placedBrands.has(b)),
      ),
    ),
  ];
  if (unplacedStorySlugs.length > 0) {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("brands")
      .select("slug, category")
      .in("slug", unplacedStorySlugs);
    for (const row of data ?? []) {
      if (row.category) {
        const list = brandsByCategory.get(row.category) ?? [];
        if (!list.includes(row.slug)) list.push(row.slug);
        brandsByCategory.set(row.category, list);
      }
    }
  }

  return deriveCategoryEditorialLinks(
    categorySlug,
    subcategorySlug,
    placements,
    storyBrands,
    brandsByCategory,
  );
}

export async function getStoryRelatedTrails(
  storySlug: string,
): Promise<TrailLink[]> {
  const result = await getAllStories("zh-TW");
  if (!result.ok) return [];

  const story = result.stories.find((s) => s.slug === storySlug);
  if (!story) return [];

  const brands = story.frontmatter.brands ?? [];
  if (brands.length === 0) return [];

  const placements = await collectAllPlacements();
  return deriveStoryRelatedTrails(brands, placements);
}
