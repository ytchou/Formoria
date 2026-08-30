import { getTranslations } from "next-intl/server";
import { Typography } from "@/components/ui/typography";
import type { AppLocale } from "@/i18n/locale-preference";
import type { BrandVisitLinkFields } from "@/lib/brands/link-fallback";
import type { CuratedProduct } from "@/lib/services/curated-products";
import { subcategoryBySlug, subcategoryLabel } from "@/lib/taxonomy/ontology";
import {
  groupProductsIntoRails,
  type ProductRailGroup,
} from "@/lib/curated-products/brand-rails";
import {
  SelectedProductTile,
  type SelectedProductTileLabels,
} from "./selected-product-tile";
import { ProductRail } from "./product-rail";

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
    unavailable: t("unavailable"),
    madeInTaiwan: t("madeInTaiwan"),
  };
  const rails = groupProductsIntoRails(products);
  const renderRail = ({
    subcategory,
    products: railProducts,
  }: ProductRailGroup) => {
    const node = subcategoryBySlug(subcategory);
    const heading = node ? subcategoryLabel(node, locale) : subcategory;
    return (
      <section key={subcategory} className="space-y-4">
        <Typography as="h3" variant="cardTitle">
          {heading}
        </Typography>
        <ProductRail
          ariaLabel={heading}
          previousLabel={t("previous")}
          nextLabel={t("next")}
        >
          {railProducts.map((product) => (
            <SelectedProductTile
              key={product.key}
              locale={locale}
              product={product}
              labels={labels}
              mode="outbound"
              brand={brand}
            />
          ))}
        </ProductRail>
      </section>
    );
  };

  return (
    <section className="space-y-stack" data-brand-selected-products>
      <div className="space-y-2">
        <Typography as="h2" variant="sectionTitleLarge">
          {t("heading")}
        </Typography>
        <Typography as="p" variant="cardDescription">
          {t("note")}
        </Typography>
      </div>

      <div className="space-y-stack">{rails.slice(0, 3).map(renderRail)}</div>
      {rails.length > 3 ? (
        <details className="border-t border-rule pt-4">
          <summary className="min-h-12 cursor-pointer type-body-sm font-medium text-accent">
            {t("moreCategories", { count: rails.length - 3 })}
          </summary>
          <div className="mt-stack space-y-stack">
            {rails.slice(3).map(renderRail)}
          </div>
        </details>
      ) : null}
    </section>
  );
}
