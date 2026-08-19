import { getTranslations } from "next-intl/server";
import { Grid } from "@/components/ui/grid";
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
    unavailable: t("unavailable"),
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

      <Grid as="ul" cols="thirds" className="list-none gap-y-stack p-0">
        {products.map((product) => (
          <SelectedProductTile
            key={product.key}
            locale={locale}
            product={product}
            labels={labels}
            mode="outbound"
            // THE ONE SURFACE THAT ASKS FOR THE TRUST LABEL (D11). Here a
            // selected product sits among the brand's other things, so the
            // label distinguishes something; on the homepage wall and in a
            // trail every tile is selected and it would distinguish nothing.
            // A flag, not a string: `TrustLabel` reads the text from
            // `trustLabel.selected`, the one place that sentence is spelled.
            showsTrustLabel
            brand={brand}
          />
        ))}
      </Grid>
    </section>
  );
}
