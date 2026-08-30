import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/locale-preference";
import type { BrandVisitLinkFields } from "@/lib/brands/link-fallback";
import type { CuratedProduct } from "@/lib/services/curated-products";
import {
  groupProductsIntoRails,
} from "@/lib/curated-products/brand-rails";
import type { SelectedProductTileLabels } from "./selected-product-tile";
import { ProductShelf } from "./product-shelf";

export type BrandSelectedProductsProps = {
  locale: AppLocale;
  brand: BrandVisitLinkFields & { slug: string };
  products: CuratedProduct[];
};

/**
 * Server component that passes grouped products down to the interactive
 * ProductShelf client component. Keeps `data-brand-selected-products` on the
 * outer section for e2e selectors.
 */
export async function BrandSelectedProducts({
  locale,
  brand,
  products,
}: BrandSelectedProductsProps) {
  if (products.length === 0) return null;

  const t = await getTranslations({
    locale,
    namespace: "brandDetail.selectedProducts",
  });
  const labels: SelectedProductTileLabels = {
    cta: t("cta"),
    brandSiteCta: t("brandSiteCta"),
    unavailable: t("unavailable"),
    madeInTaiwan: t("madeInTaiwan"),
  };
  const groups = groupProductsIntoRails(products);

  return (
    <section data-brand-selected-products>
      <ProductShelf
        groups={groups}
        allLabel={t("allCategories")}
        labels={labels}
        locale={locale}
        brand={brand}
        heading={t("heading")}
        note={t("note")}
        ariaLabel={t("heading")}
        previousLabel={t("previous")}
        nextLabel={t("next")}
      />
    </section>
  );
}
