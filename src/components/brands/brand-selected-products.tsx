import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/locale-preference";
import type { BrandVisitLinkFields } from "@/lib/brands/link-fallback";
import type { CuratedProduct } from "@/lib/services/curated-products";
import { groupProductsIntoRails } from "@/lib/curated-products/brand-rails";
import { safeImageSrc } from "@/lib/images/allowed-image-hosts";
import type { SelectedProductTileLabels } from "./selected-product-tile";
import { ProductShelf } from "./product-shelf";

export type BrandSelectedProductsProps = {
  locale: AppLocale;
  brand: BrandVisitLinkFields & { slug: string };
  products: CuratedProduct[];
};

/**
 * Server component that passes grouped products down to the interactive
 * ProductShelf client component. Products without a usable photo are skipped,
 * and the section renders nothing when none remain. Keeps
 * `data-brand-selected-products` on the outer section for e2e selectors.
 */
export async function BrandSelectedProducts({
  locale,
  brand,
  products,
}: BrandSelectedProductsProps) {
  // Render-side guard: a 選物 tile never shows a letter placeholder, so a
  // photo-less product is skipped before grouping (subcategory chips count only
  // what renders). The data-side publish precondition is a separate ticket.
  const renderable = products.filter(
    (product) => safeImageSrc(product.imageUrl) !== null,
  );
  if (renderable.length === 0) return null;

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
  const groups = groupProductsIntoRails(renderable);

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
