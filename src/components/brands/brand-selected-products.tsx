import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/locale-preference";
import type { BrandVisitLinkFields } from "@/lib/brands/link-fallback";
import type { CuratedProduct } from "@/lib/services/curated-products";
import { groupProductsIntoRails } from "@/lib/curated-products/brand-rails";
import type {
  SelectedProductTileGuide,
  SelectedProductTileLabels,
} from "./selected-product-tile";
import { ProductShelf } from "./product-shelf";

export type BrandSelectedProductsProps = {
  locale: AppLocale;
  brand: BrandVisitLinkFields & { slug: string };
  products: CuratedProduct[];
  /**
   * Product key → the guide that placed it. The page loads it alongside the
   * products; a failed read arrives as `{}` and the tiles render without
   * guide links (and so without a 選物 label), never an error.
   */
  guides: Record<string, SelectedProductTileGuide>;
};

/**
 * Server component that passes grouped products down to the interactive
 * ProductShelf client component. Expects `getPublishedCuratedProductsForBrand`
 * output: photo-less products are already dropped there (DEV-1962), which is
 * what lets the page gate the section and its nav link on `length > 0`. The page's `BrandSection` is the outer section and carries
 * `data-brand-selected-products` for e2e selectors.
 */
export async function BrandSelectedProducts({
  locale,
  brand,
  products,
  guides,
}: BrandSelectedProductsProps) {
  const t = await getTranslations({
    locale,
    namespace: "brandDetail.selectedProducts",
  });
  const labels: SelectedProductTileLabels = {
    cta: t("cta"),
    brandSiteCta: t("brandSiteCta"),
    unavailable: t("unavailable"),
    madeInTaiwan: t("madeInTaiwan"),
    inGuide: t("inGuide"),
  };
  const groups = groupProductsIntoRails(products);

  return (
    <ProductShelf
      groups={groups}
      allLabel={t("allCategories")}
      labels={labels}
      locale={locale}
      brand={brand}
      heading={t("heading")}
      note={t("note", { count: products.length })}
      ariaLabel={t("heading")}
      previousLabel={t("previous")}
      nextLabel={t("next")}
      guides={guides}
    />
  );
}
