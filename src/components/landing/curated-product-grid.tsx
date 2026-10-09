import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";

import { ViewItemListTracker } from "@/components/analytics/view-item-list-tracker";
import type { SelectedProductTileLabels } from "@/components/brands/selected-product-tile";
import { buttonVariants } from "@/components/ui/button";
import { PhotoBand } from "@/components/ui/photo-band";
import type { AppLocale } from "@/i18n/locale-preference";
import { Link } from "@/i18n/navigation";
import type { WallTileSlot } from "@/lib/curated-products/wall-tile";
import { routes } from "@/lib/routes";
import { VISIBLE_L1_CATEGORIES } from "@/lib/taxonomy/ontology";
import { CategoryFilter } from "./category-filter";
import { WallGroupGrid } from "./wall-group-grid";

/**
 * The homepage selection band. Only the "all" group is server-rendered; a
 * category chip fetches its group from `GET /api/home-wall` on first selection
 * (DEV-1972) — the six hidden groups used to cost ~268 KB of homepage HTML.
 * Every string the client filter needs arrives from here as a prop.
 */
export async function CuratedProductGrid({
  slots,
  locale,
}: {
  slots: WallTileSlot[];
  locale: AppLocale;
}) {
  const t = await getTranslations("landing");
  // No `common.retry` exists; `errors.boundary.retry` is the shared retry copy.
  const tErrors = await getTranslations("errors.boundary");
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

  return (
    <PhotoBand
      image="/images/selection-bg.webp"
      alt=""
      scrim="dark"
      imageQuality={20}
      contentClassName="text-on-ink"
    >
      <div className="text-center">
        <h2 className="type-section text-on-ink">
          {t("selection.headline")}
        </h2>
        <p className="mt-3 type-body text-on-ink">{t("selection.subtitle")}</p>
      </div>

      <CategoryFilter
        categories={categories}
        locale={locale}
        labels={{
          tile: productLabels,
          loading: t("selection.loading"),
          loadFailed: t("selection.loadFailed"),
          retry: tErrors("retry"),
        }}
      >
        <WallGroupGrid
          slug="all"
          slots={slots}
          locale={locale}
          labels={productLabels}
        />
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
        itemCount={slots.length}
      />
    </PhotoBand>
  );
}
