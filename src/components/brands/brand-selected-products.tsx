import { getTranslations } from "next-intl/server";
import { Typography } from "@/components/ui/typography";
import type { AppLocale } from "@/i18n/locale-preference";
import type { BrandVisitLinkFields } from "@/lib/brands/link-fallback";
import type { CuratedProduct } from "@/lib/services/curated-products";
import {
  SelectedProductTile,
  type SelectedProductTileLabels,
} from "./selected-product-tile";

export type BrandSelectedProductsProps = {
  locale: AppLocale;
  brand: BrandVisitLinkFields & { slug: string };
  products: CuratedProduct[];
};

/**
 * Server-only, by design: the whole section is static markup, so the brand page
 * gains a section without gaining a client chunk. Outbound anchors therefore
 * carry their analytics context as data attributes rather than an onClick.
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
    selectedBadge: t("selectedBadge"),
    brandProvidedBadge: t("brandProvidedBadge"),
    unavailable: t("unavailable"),
  };

  return (
    <section className="space-y-6" data-brand-selected-products>
      <div className="space-y-2">
        <Typography as="h2" variant="sectionTitle">
          {t("heading")}
        </Typography>
        <Typography as="p" variant="cardDescription">
          {t("note")}
        </Typography>
      </div>

      <ul className="grid list-none grid-cols-1 gap-x-6 gap-y-8 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => (
          <SelectedProductTile
            key={product.key}
            locale={locale}
            product={product}
            labels={labels}
            mode="outbound"
            brand={brand}
          />
        ))}
      </ul>
    </section>
  );
}
