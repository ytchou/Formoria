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
  lang,
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
  /**
   * The content's `lang` when it differs from the page locale (a zh-TW trail
   * on /en), from `contentLangFor`. Absent when they match.
   */
  lang?: string;
}) {
  const notes = Object.fromEntries(
    sections.map((section) => [section.key, section.notes ?? {}]),
  );
  return (
    <TrailProductsProvider
      value={{ trailSlug, locale, products, labels, notes }}
    >
      {/*
        Every rule below reaches INTO the authored MDX, which is the only way to
        reach it: `<section id="…">` is explicit JSX and MDX never routes
        explicit JSX through the component map, so no `section` entry there can
        ever fire. The selectors are scoped to this wrapper so nothing else on
        the page inherits them.

        Trail prose keeps the shared reading cap: the component map puts
        `prose-measure` (48rem, about 42 zh characters a line) on `p`, `ul`,
        `ol`, and `blockquote`, exactly as on a story page. The product grids
        are separate elements that carry no measure, so they still span the
        full page container.
      */}
      <div lang={lang} className="[&>section]:scroll-mt-24">
        <MDXRemote
          source={source}
          options={{ blockJS: false, blockDangerousJS: true }}
          components={createStoryComponentMap({ trailSections: sections })}
        />
      </div>
    </TrailProductsProvider>
  );
}
