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
import type { GroupedWallSlots } from "@/lib/curated-products/home-wall";
import { routes } from "@/lib/routes";
import { VISIBLE_L1_CATEGORIES } from "@/lib/taxonomy/ontology";
import { CategoryFilter } from "./category-filter";

export async function CuratedProductGrid({
  groups,
  locale,
}: {
  groups: GroupedWallSlots;
  locale: AppLocale;
}) {
  const t = await getTranslations("landing");
  const isEnglish = locale === "en";

  const productLabels: SelectedProductTileLabels = {
    cta: t("selectedProducts.productCta"),
    brandSiteCta: t("selectedProducts.brandSiteCta"),
    unavailable: t("selectedProducts.unavailable"),
    madeInTaiwan: t("selectedProducts.madeInTaiwan"),
  };

  const categories = [
    { slug: "all", label: t("selection.allCategories") },
    ...VISIBLE_L1_CATEGORIES.map((cat) => ({
      slug: cat.slug,
      label: isEnglish ? cat.name : cat.nameZh,
    })),
  ];

  const allSlots = groups.all ?? [];

  return (
    <PhotoBand
      image="/images/selection-bg.webp"
      alt=""
      scrim="dark"
      imageQuality={20}
      contentClassName="text-on-ink"
    >
      <div className="text-center">
        <h2 className="type-page-title font-ming text-on-ink">
          {t("selection.headline")}
        </h2>
        <p className="mt-3 type-body text-on-ink">{t("selection.subtitle")}</p>
      </div>

      <CategoryFilter categories={categories}>
        {Object.entries(groups).map(([slug, slots]) => (
          <div key={slug} data-category={slug} hidden={slug !== "all"}>
            <Grid
              as="ul"
              cols="cards"
              className="mt-8 list-none p-0 lg:grid-cols-5"
            >
              {slots.map((slot, index) => (
                <SelectedProductTile
                  key={`${slot.product.brandSlug}-${slot.product.key}`}
                  locale={locale}
                  product={slot.product}
                  labels={productLabels}
                  mode="wall"
                  ratio="1:1"
                  imageSizes="(max-width: 640px) calc(100vw - 3rem), (max-width: 1024px) 50vw, (max-width: 1600px) 20vw, 282px"
                  imageQuality={60}
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
          </div>
        ))}
      </CategoryFilter>

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
        itemCount={allSlots.length}
      />
    </PhotoBand>
  );
}
