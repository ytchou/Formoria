import {
  SelectedProductTile,
  type SelectedProductTileLabels,
} from "@/components/brands/selected-product-tile";
import type { AppLocale } from "@/i18n/locale-preference";
import type { WallTileSlot } from "@/lib/curated-products/wall-tile";
import { cn } from "@/lib/utils";
import { phoneCapClass, WallGroup } from "./wall-group";

export type WallGroupGridProps = {
  slug: string;
  slots: WallTileSlot[];
  locale: AppLocale;
  labels: SelectedProductTileLabels;
};

/**
 * The ONE renderer for a homepage band group (DEV-1972). The server renders
 * the "all" group through it, and the category filter renders every fetched
 * group through it from a lazy chunk, so markup, classes, the phone cap and
 * the tracking positions cannot drift between the two. Isomorphic: no
 * "use client", no async, every string arrives as a prop.
 */
export function WallGroupGrid({ slug, slots, locale, labels }: WallGroupGridProps) {
  return (
    <WallGroup slug={slug}>
      {slots.map((slot, index) => (
        <SelectedProductTile
          key={`${slot.product.brandSlug}-${slot.product.key}`}
          locale={locale}
          product={slot.product}
          labels={labels}
          mode="wall"
          ratio="1:1"
          imageSizes="(max-width: 640px) calc(50vw - 1.875rem), (max-width: 1024px) 50vw, (max-width: 1600px) 20vw, 282px"
          imageQuality={60}
          className={cn("bg-ground", phoneCapClass(index))}
          brand={slot.product.brand}
          brandSlug={slot.product.brandSlug}
          brandName={slot.product.brandName}
          tracking={{
            brandSlug: slot.product.brandSlug,
            position: index,
            surface: "homepage_wall",
          }}
        />
      ))}
    </WallGroup>
  );
}
