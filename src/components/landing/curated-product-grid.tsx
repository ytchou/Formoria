import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";

import { ViewItemListTracker } from "@/components/analytics/view-item-list-tracker";
import {
  SelectedProductTile,
  type SelectedProductTileLabels,
} from "@/components/brands/selected-product-tile";
import { Grid } from "@/components/ui/grid";
import { buttonVariants } from "@/components/ui/button";
import { PhotoBand } from "@/components/ui/photo-band";
import type { AppLocale } from "@/i18n/locale-preference";
import { Link } from "@/i18n/navigation";
import {
  MAX_HOME_GRID_PRODUCTS,
  type WallSlot,
} from "@/lib/curated-products/home-wall";
import { routes } from "@/lib/routes";

export async function CuratedProductGrid({
  slots,
  locale,
}: {
  slots: WallSlot[];
  locale: AppLocale;
}) {
  const t = await getTranslations("landing");
  const visible = slots.slice(0, MAX_HOME_GRID_PRODUCTS);

  const productLabels: SelectedProductTileLabels = {
    cta: t("selectedProducts.productCta"),
    brandSiteCta: t("selectedProducts.brandSiteCta"),
    unavailable: t("selectedProducts.unavailable"),
    madeInTaiwan: t("selectedProducts.madeInTaiwan"),
  };

  return (
    <PhotoBand
      image="/images/selection-bg.webp"
      alt=""
      scrim="dark"
      contentClassName="text-on-ink"
    >
      <div className="text-center">
        <h2 className="type-page-title font-ming text-on-ink">
          {t("selection.headline")}
        </h2>
        <p className="mt-3 type-body text-on-ink">{t("selection.subtitle")}</p>
      </div>

      <Grid cols="cards" className="mt-8 lg:grid-cols-5">
        {visible.map((slot, index) => (
          <SelectedProductTile
            key={`${slot.product.brandSlug}-${slot.product.key}`}
            locale={locale}
            product={slot.product}
            labels={productLabels}
            mode="wall"
            ratio="1:1"
            imageSizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1600px) 20vw, 282px"
            className="bg-ground"
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
      </Grid>

      <div className="mt-8 text-center">
        <Link
          href={routes.discover()}
          className={buttonVariants({
            variant: "primary",
            shape: "pill",
            className:
              "focus-visible:ring-on-ink focus-visible:ring-offset-surface-dark",
          })}
        >
          {t("selection.cta")}
          <ArrowRight aria-hidden="true" />
        </Link>
      </div>

      <ViewItemListTracker
        listName="homepage_wall"
        itemCount={visible.length}
      />
    </PhotoBand>
  );
}
