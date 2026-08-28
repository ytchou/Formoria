import { MDXRemote } from "next-mdx-remote/rsc";

import type { AppLocale } from "@/i18n/locale-preference";
import type { SelectedProductTileLabels } from "@/components/brands/selected-product-tile";
import type { TrailCuratedProduct } from "@/lib/services/curated-products";
import {
  createStoryComponentMap,
  type TrailSectionRef,
} from "@/lib/mdx/components";
import { TrailProductsProvider } from "@/components/trails/trail-products";

export function TrailContent({
  source,
  trailSlug,
  locale,
  products,
  labels,
  sections,
}: {
  source: string;
  trailSlug: string;
  locale: AppLocale;
  products: readonly TrailCuratedProduct[];
  labels: SelectedProductTileLabels;
  /**
   * The trail's declared sections, in order. They number the `##` headings the
   * body authors — see `createStoryComponentMap`. Passed from the route rather
   * than parsed out of the MDX because the frontmatter is the ordered list and
   * the body is not.
   */
  sections: readonly TrailSectionRef[];
}) {
  return (
    <TrailProductsProvider value={{ trailSlug, locale, products, labels }}>
      {/*
        Every rule below reaches INTO the authored MDX, which is the only way to
        reach it: `<section id="…">` is explicit JSX and MDX never routes
        explicit JSX through the component map, so no `section` entry there can
        ever fire. The selectors are scoped to this wrapper so nothing else on
        the page inherits them.

        Trail prose uses the full page measure. These route-local selectors
        override the shared story reading cap without widening prose on story
        pages, while product grids continue to span the same container.
      */}
      <div className="[&_blockquote]:max-w-none [&_ol]:max-w-none [&_p]:max-w-none [&_ul]:max-w-none [&>section]:scroll-mt-24">
        <MDXRemote
          source={source}
          options={{ blockJS: false, blockDangerousJS: true }}
          components={createStoryComponentMap({ trailSections: sections })}
        />
      </div>
    </TrailProductsProvider>
  );
}
