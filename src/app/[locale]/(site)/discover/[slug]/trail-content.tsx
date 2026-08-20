import { MDXRemote } from "next-mdx-remote/rsc";

import type { AppLocale } from "@/i18n/locale-preference";
import type { SelectedProductTileLabels } from "@/components/brands/selected-product-tile";
import type { TrailCuratedProduct } from "@/lib/services/curated-products";
import { createStoryComponentMap, type TrailSectionRef } from "@/lib/mdx/components";
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

        `[&>section>p]` indents the section intro to the heading's text column,
        which is what makes the ordinal read as a gutter rather than as a
        prefix. Section intros are load-bearing editorial content — the trail
        states WHY a group was gathered, once, up front — so they get the
        measure, not a caption treatment.

        The 46rem cap is on PROSE only. The product grid inside each section
        spans the full container, so a paragraph and a three-up row of objects
        do not have to share one width.
      */}
      <div className="[&>p]:max-w-[46rem] [&>section>p]:max-w-[46rem] [&>section>p]:md:pl-16 [&>section]:scroll-mt-24">
        <MDXRemote
          source={source}
          options={{ blockJS: false, blockDangerousJS: true }}
          components={createStoryComponentMap({ trailSections: sections })}
        />
      </div>
    </TrailProductsProvider>
  );
}
