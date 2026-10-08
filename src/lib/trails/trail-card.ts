/**
 * The fields a trail card actually renders (DEV-1972).
 *
 * Every prop handed to a client component is serialized into the page's inline
 * RSC payload, so passing a whole `TrailEntry` ships its sections, per-product
 * notes, FAQ, sources, and governance fields in the HTML. Cards receive only
 * what they render. Keep this module a leaf — type-only imports — because a
 * "use client" component imports its types.
 */
import type { CuratedProduct } from "@/lib/services/curated-products";
import type { TrailEntry } from "@/lib/services/trails";

export type TrailCard = {
  slug: string;
  frontmatter: Pick<
    TrailEntry["frontmatter"],
    "title" | "description" | "promise" | "heroImage" | "heroImageAlt"
  >;
};

export type TrailPeekProduct = Pick<CuratedProduct, "id" | "imageUrl">;

/** Optional keys are omitted, not set to `undefined`, so the payload carries no `$undefined`. */
export function toTrailCard(trail: TrailEntry): TrailCard {
  const { title, description, promise, heroImage, heroImageAlt } =
    trail.frontmatter;
  return {
    slug: trail.slug,
    frontmatter: {
      title,
      ...(description === undefined ? {} : { description }),
      ...(promise === undefined ? {} : { promise }),
      ...(heroImage === undefined ? {} : { heroImage }),
      ...(heroImageAlt === undefined ? {} : { heroImageAlt }),
    },
  };
}

export function toTrailPeekProduct(product: CuratedProduct): TrailPeekProduct {
  return { id: product.id, imageUrl: product.imageUrl };
}

export function toTrailPeeks(
  peeks: Record<string, CuratedProduct[]>,
): Record<string, TrailPeekProduct[]> {
  return Object.fromEntries(
    Object.entries(peeks).map(([slug, products]) => [
      slug,
      products.map(toTrailPeekProduct),
    ]),
  );
}
