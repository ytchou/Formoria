import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/locale-preference";
import type { BrandVisitLinkFields } from "@/lib/brands/link-fallback";
import type { CuratedProduct } from "@/lib/services/curated-products";
import { groupProductsIntoRails } from "@/lib/curated-products/brand-rails";
import { getBrandProductTrailLinks } from "@/lib/services/editorial-links";
import type { SelectedProductTileLabels } from "./selected-product-tile";
import { ProductShelf } from "./product-shelf";

export type BrandSelectedProductsProps = {
  locale: AppLocale;
  brand: BrandVisitLinkFields & { slug: string };
  products: CuratedProduct[];
};

/**
 * Server component that passes grouped products down to the interactive
 * ProductShelf client component. Expects `getPublishedCuratedProductsForBrand`
 * output: photo-less products are already dropped there (DEV-1962), which is
 * what lets the page gate the section and its nav link on `length > 0`. Keeps
 * `data-brand-selected-products` on the outer section for e2e selectors.
 */
export async function BrandSelectedProducts({
  locale,
  brand,
  products,
}: BrandSelectedProductsProps) {
  const [t, guides] = await Promise.all([
    getTranslations({ locale, namespace: "brandDetail.selectedProducts" }),
    // The guide links are an enhancement: a failed read shows the tiles
    // without them (and so without a 選物 label), never an error.
    getBrandProductTrailLinks(brand.slug).catch(() => ({})),
  ]);
  const labels: SelectedProductTileLabels = {
    cta: t("cta"),
    brandSiteCta: t("brandSiteCta"),
    unavailable: t("unavailable"),
    madeInTaiwan: t("madeInTaiwan"),
    inGuide: t("inGuide"),
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
        note={t("note", { count: products.length })}
        ariaLabel={t("heading")}
        previousLabel={t("previous")}
        nextLabel={t("next")}
        guides={guides}
      />
    </section>
  );
}
