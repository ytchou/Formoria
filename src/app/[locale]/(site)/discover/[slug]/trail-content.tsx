import { MDXRemote } from "next-mdx-remote/rsc";

import type { AppLocale } from "@/i18n/locale-preference";
import type { SelectedProductTileLabels } from "@/components/brands/selected-product-tile";
import type { TrailCuratedProduct } from "@/lib/services/curated-products";
import { createStoryComponentMap } from "@/lib/mdx/components";
import { TrailProductsProvider } from "@/components/trails/trail-products";

export function TrailContent({
  source,
  trailSlug,
  locale,
  products,
  labels,
}: {
  source: string;
  trailSlug: string;
  locale: AppLocale;
  products: readonly TrailCuratedProduct[];
  labels: SelectedProductTileLabels;
}) {
  return (
    <TrailProductsProvider value={{ trailSlug, locale, products, labels }}>
      <MDXRemote
        source={source}
        options={{ blockJS: false, blockDangerousJS: true }}
        components={createStoryComponentMap()}
      />
    </TrailProductsProvider>
  );
}
